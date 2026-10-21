import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { generateNodeAddonSource, canBuildNodeAddon, napiAddonFileName } from './napi-addon.js';
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

  it('extracts JS args per ABI class (bigint passes a lossless flag) and validates JS-level argc', () => {
    const src = generateNodeAddonSource(PROFILE);
    assert.match(src, /napi_get_value_double\(env, argv\[0\], &a0\)/);
    assert.match(src, /napi_get_value_string_utf8\(env, argv\[0\], NULL, 0, &s0_len\)/);
    assert.match(src, /napi_get_value_bigint_int64\(env, argv\[0\], &a0, &lossless0\)/);
    assert.match(src, /napi_get_value_uint32\(env, argv\[0\], &t0\)/);
    assert.match(src, /napi_get_value_boolean\(env, argv\[0\], &a0\)/);
    // greet takes ONE js argument (two C slots) — the check counts JS args
    assert.match(src, /greet expects 1 argument"/);
    assert.match(src, /add expects 2 arguments"/);
  });

  it('guards allocation and frees string buffers on a cleanup path', () => {
    const src = generateNodeAddonSource(PROFILE);
    assert.match(src, /#define NAPI_CHECK_GOTO/);
    assert.match(src, /char\* s0 = NULL;/);
    assert.match(src, /s0 = \(char\*\)malloc\(s0_len \+ 1\);/);
    assert.match(src, /if \(s0 == NULL\) \{ napi_throw_error\(env, NULL, "scriptcable addon: out of memory"\); goto cleanup; \}/);
    assert.match(src, /cleanup:\n  free\(s0\);\n  return res;/);
  });

  it('returns bool via napi_get_boolean and unsigned classes without sign wrap', () => {
    const src = generateNodeAddonSource(PROFILE);
    assert.match(src, /napi_get_boolean\(env, r, &res\)/);
    assert.match(src, /napi_create_uint32\(env, \(uint32_t\)r, &res\)/);
    assert.match(src, /napi_create_string_utf8\(env, \(const char\*\)out_ptr, \(size_t\)out_len, &res\)/);
    assert.match(src, /napi_create_bigint_int64\(env, r, &res\)/);
  });

  it('registers exports and runs the init symbol in NAPI_MODULE_INIT', () => {
    const src = generateNodeAddonSource(PROFILE);
    assert.match(src, /NAPI_MODULE_INIT\(\) \{/);
    assert.match(src, /demo_init\(\);/);
    assert.match(src, /napi_create_function\(env, "add", NAPI_AUTO_LENGTH, __sc_add, NULL, &fn\)/);
    assert.match(src, /napi_set_named_property\(env, exports, "greet", fn\)/);
  });
});
