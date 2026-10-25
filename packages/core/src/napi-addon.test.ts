import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import {
  generateNodeAddonSource,
  generateBatchExecutiveSource,
  generateSharedBatchSource,
  SHARED_BATCH_SYMBOL,
  BATCH_EXEC_SYMBOLS,
  canBuildNodeAddon,
  napiAddonFileName,
} from './napi-addon.js';
import type { ScriptcableProfile } from '@scriptcable/types';

const PROFILE: ScriptcableProfile = {
  profile_format: 1,
  name: 'demo',
  entry: 'src/core.ts',
  emission: 'llvm',
  abi: { prefix: 'demo_', init_symbol: 'demo_init', sink_register_symbol: 'demo_sink' },
  exports: [
    { export: 'add', symbol: 'demo_add', params: ['f64', 'f64'], returns: 'f64' },
    { export: 'greet', symbol: 'demo_greet', params: ['string'], returns: 'string' },
    { export: 'big', symbol: 'demo_big', params: ['i64'], returns: 'i64' },
    { export: 'flag', symbol: 'demo_flag', params: ['bool'], returns: 'bool' },
    { export: 'u32id', symbol: 'demo_u32id', params: ['u32'], returns: 'u32' },
  ],
};

describe('napi-addon', () => {
  it('skips cores with callbacks, names the addon {name}.node', () => {
    assert.equal(canBuildNodeAddon(PROFILE), true);
    assert.equal(canBuildNodeAddon({ ...PROFILE, callbacks: [{ name: 'cb', params: [], returns: 'void' }] }), false);
    assert.equal(napiAddonFileName('demo'), 'demo.node');
  });

  it('declares fixed extern signatures, including (ptr,len) string ABI', () => {
    const src = generateNodeAddonSource(PROFILE);
    assert.match(src, /extern double demo_add\(double, double\);/);
    assert.match(src, /extern void demo_greet\(const uint8_t\*, int64_t, const uint8_t\*\*, int64_t\*\);/);
    assert.match(src, /extern int64_t demo_big\(int64_t\);/);
    assert.match(src, /extern uint32_t demo_u32id\(uint32_t\);/);
    assert.match(src, /extern bool demo_flag\(bool\);/);
  });

  it('extracts JS args per ABI class (i64 accepts number and BigInt) and validates JS-level argc', () => {
    const src = generateNodeAddonSource(PROFILE);
    assert.match(src, /napi_get_value_double\(env, argv\[0\], &a0\)/);
    assert.match(src, /napi_get_value_string_utf8\(env, argv\[0\], NULL, 0, &s0_len\)/);
    // i64/u64 are TS-number classes (scriptc ≥ 0.4): coerce numbers, keep the
    // BigInt path for lossless callers
    assert.match(src, /if \(vt0 == napi_bigint\) \{ NAPI_CHECK\(napi_get_value_bigint_int64\(env, argv\[0\], &a0, &lossless0\)\); \}/);
    assert.match(src, /else \{ NAPI_CHECK\(napi_get_value_int64\(env, argv\[0\], &a0\)\); \}/);
    assert.match(src, /napi_get_value_uint32\(env, argv\[0\], &t0\)/);
    // napi has no _boolean getter — the correct symbol is napi_get_value_bool
    // (a bool-param addon used to fail its compile and silently fall back to
    // FFI; surfaced by the batch round's fixture, 2026-10-25).
    assert.match(src, /napi_get_value_bool\(env, argv\[0\], &a0\)/);
    // greet takes ONE js argument (two C slots) — the check counts JS args
    assert.match(src, /greet expects 1 argument"/);
    assert.match(src, /add expects 2 arguments"/);
  });

  it('guards allocation and reuses a thread-local utf8 scratch (no per-call malloc)', () => {
    const src = generateNodeAddonSource(PROFILE);
    assert.match(src, /#define NAPI_CHECK_GOTO/);
    assert.match(src, /static _Thread_local char\* s0_buf = NULL;/);
    assert.match(src, /char\* s0_grown = \(char\*\)malloc\(s0_next\);/);
    // failed grow resets cap to 0 so the next call retries (F4)
    assert.match(src, /s0_buf = NULL;\n    s0_cap = 0;/);
    // the scratch outlives the call — the cleanup path frees nothing per call
    assert.doesNotMatch(src, /free\(s0\);/);
    assert.match(src, /cleanup:\n  return res;/);
  });

  it('returns bool via napi_get_boolean and unsigned classes without sign wrap', () => {
    const src = generateNodeAddonSource(PROFILE);
    assert.match(src, /napi_get_boolean\(env, r, &res\)/);
    assert.match(src, /napi_create_uint32\(env, \(uint32_t\)r, &res\)/);
    assert.match(src, /napi_create_string_utf8\(env, \(const char\*\)out_ptr, \(size_t\)out_len, &res\)/);
    // i64 returns carry as double — the class contract bounds them to ±(2^53 − 1)
    assert.match(src, /napi_create_double\(env, \(double\)r, &res\)/);
  });

  it('registers exports and runs the init symbol in NAPI_MODULE_INIT', () => {
    const src = generateNodeAddonSource(PROFILE);
    assert.match(src, /NAPI_MODULE_INIT\(\) \{/);
    assert.match(src, /demo_init\(\);/);
    assert.match(src, /napi_create_function\(env, "add", NAPI_AUTO_LENGTH, __sc_add, NULL, &fn\)/);
    assert.match(src, /napi_set_named_property\(env, exports, "greet", fn\)/);
  });

  it('generates the batch executive: helpers, per-entry runners, dispatcher, registration', () => {
    const src = generateNodeAddonSource(PROFILE);
    // Grow-only per-thread result block — realloc failure leaves cap intact.
    assert.match(src, /static _Thread_local uint8_t\* __sc_bres_buf = NULL;/);
    assert.match(src, /if \(grown == NULL\) return 0; \/\* cap stays — the next batch retries \*\//);
    // Wire bounds are checked before slots are read; OOM (−1) vs bounds (0) split.
    assert.match(src, /if \(arg_base \+ \d+ > args_len\) return 0;/);
    assert.match(src, /napi_throw_range_error\(env, NULL, "batch wire bounds violation/);
    assert.match(src, /napi_throw_error\(env, NULL, "scriptcable batch: out of memory"\)/);
    // One Buffer copy back per batch; empty batch still returns a buffer.
    assert.match(src, /napi_create_buffer_copy\(env, __sc_bres_used, __sc_bres_buf \? __sc_bres_buf : \(const uint8_t\*\)""/);
    // Registration + the client-visible symbol name.
    assert.match(src, /napi_create_function\(env, "__scriptcable_batch", NAPI_AUTO_LENGTH, __sc_batch, NULL, &fn\)/);
    // Typed-array wire check: (Int32Array meta, Uint8Array args) only.
    assert.match(src, /meta_type != napi_int32_array \|\| args_type != napi_uint8_array/);
  });

  it('skips the batch executive when an export takes its name', () => {
    const hostile: ScriptcableProfile = {
      ...PROFILE,
      exports: [...PROFILE.exports, { export: '__scriptcable_batch', symbol: 'demo_batch', params: [], returns: 'void' }],
    };
    const src = generateNodeAddonSource(hostile);
    assert.doesNotMatch(src, /static napi_value __sc_batch\(/);
    assert.doesNotMatch(src, /"__scriptcable_batch", NAPI_AUTO_LENGTH, __sc_batch/);
    // The user's own export still registers under its name.
    assert.match(src, /napi_set_named_property\(env, exports, "__scriptcable_batch", fn\)/);
  });

  it('skips the executive when a wrapper name (__sc_<export>) collides with executive C symbols', () => {
    // An export named `batch` generates wrapper `__sc_batch` — the executive's
    // own function name. Emitting both would redefine the symbol in one TU
    // and the soft-fail would kill the ENTIRE addon (reproduced 2026-10-25).
    const collides: ScriptcableProfile = {
      ...PROFILE,
      exports: [...PROFILE.exports, { export: 'batch', symbol: 'demo_x_batch', params: [], returns: 'void' }],
    };
    const src = generateNodeAddonSource(collides);
    assert.doesNotMatch(src, /static napi_value __sc_batch\(napi_env env, napi_callback_info info\) \{\n  size_t argc = 2;/, 'no executive dispatcher');
    assert.match(src, /static napi_value __sc_batch\(napi_env env, napi_callback_info info\) \{\n  size_t argc = 0;/, 'the user\'s batch wrapper survives');
    // And the non-colliding profile next to it still gets the executive.
    assert.match(generateNodeAddonSource(PROFILE), /static napi_value __sc_batch\(/);
  });

  it('the collision guard knows every C symbol the executive defines/uses', () => {
    // The guard list is hand-maintained — this keeps it from drifting behind
    // BATCH_HELPERS_C (a missed symbol would re-open the F-2 collision).
    const full: ScriptcableProfile = {
      ...PROFILE,
      exports: [
        ...PROFILE.exports,
        { export: 'u32id', symbol: 'demo_u32id', params: ['u32'], returns: 'u32' },
        { export: 'big', symbol: 'demo_big', params: ['i64'], returns: 'i64' },
        { export: 'ubig', symbol: 'demo_ubig', params: ['u64'], returns: 'u64' },
        { export: 'noopv', symbol: 'demo_noopv', params: [], returns: 'void' },
      ],
    };
    const src = generateBatchExecutiveSource(full);
    const names = new Set(src.match(/__sc_[A-Za-z0-9_]+/g) ?? []);
    for (const name of names) {
      if (/^__sc_bentry_\d+$/.test(name)) continue;
      assert.ok(
        (BATCH_EXEC_SYMBOLS as readonly string[]).includes(name),
        `executive defines/uses "${name}" but the collision guard does not list it`,
      );
    }
    assert.ok(names.has('__sc_batch'), 'sanity: the executive dispatcher is present');
    assert.ok(names.has('__sc_bres_mem'), 'sanity: result-block helpers are present');
  });

  it('skips the host (.so) executive TU on symbol collision or empty exports', () => {
    const collides: ScriptcableProfile = {
      ...PROFILE,
      exports: [{ export: 'x', symbol: SHARED_BATCH_SYMBOL, params: [], returns: 'void' }],
    };
    assert.equal(generateSharedBatchSource(collides), '', 'symbol collision must drop the TU');
    assert.equal(generateSharedBatchSource({ ...PROFILE, exports: [] }), '', 'no exports → no TU');
    const src = generateSharedBatchSource(PROFILE);
    assert.match(src, new RegExp(`int64_t ${SHARED_BATCH_SYMBOL}\\(`));
    // the TU compiles standalone — no node_api.h transitively pulling stdbool
    assert.match(src, /#include <stdbool\.h>/);
    assert.match(src, /#include <stdint\.h>/);
    // per-thread cursor (batch-round F-1) and negative error codes
    assert.match(src, /static _Thread_local size_t __sc_bres_used = 0;/);
    assert.match(src, /return -2;/);
    assert.match(src, /return -3;/);
    // a symbol colliding with any TU helper must ALSO drop the TU — the .so
    // path has no toolchain-level soft-fail, so a colliding TU would hard-fail
    // the whole build (so-batch review F-1)
    for (const hostile of ['__sc_bres_buf', '__sc_bres_u32', '__sc_bentry_0']) {
      const prof: ScriptcableProfile = {
        ...PROFILE,
        exports: [{ export: 'x', symbol: hostile, params: [], returns: 'void' }],
      };
      assert.equal(generateSharedBatchSource(prof), '', `symbol ${hostile} must drop the TU`);
    }
    // and `__sc_batch` is not a TU symbol here — an export so named keeps the TU
    const batchNamed: ScriptcableProfile = {
      ...PROFILE,
      exports: [{ export: 'x', symbol: '__sc_batch', params: [], returns: 'void' }],
    };
    assert.match(generateSharedBatchSource(batchNamed), /int64_t scriptc_batch\(/);
  });
});
