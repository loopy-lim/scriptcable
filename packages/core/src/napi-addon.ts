/**
 * Direct N-API binding: the build compiles a tiny typed C addon that wraps
 * the core's C ABI exports with fixed signatures, so Node and Bun call the
 * core through the thin N-API boundary instead of generic FFI (koffi /
 * bun:ffi). The build already knows every export's ABI class at compile
 * time — that's all a statically typed binding needs.
 *
 * Soft failure by design: if headers or the compiler are unavailable the
 * build skips the addon (clients fall back to the shared library), it never
 * fails the build.
 */
import { spawn } from 'node:child_process';
import { which } from './which.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { AbiClass, ScriptcableProfile } from '@scriptcable/types';
import { ScriptcableToolchainError } from '@scriptcable/types';
import { STUB_SOURCE } from './link-shared.js';

export function canBuildNodeAddon(profile: ScriptcableProfile): boolean {
  return profile.exports.length > 0 && !profile.callbacks?.length;
}

export function napiAddonFileName(name: string): string {
  return `${name}.node`;
}

function cParamType(cls: AbiClass): string {
  switch (cls) {
    case 'f64': return 'double';
    case 'f32': return 'float';
    case 'u8': return 'uint8_t';
    case 'u16': return 'uint16_t';
    case 'u32': return 'uint32_t';
    case 'i8': return 'int8_t';
    case 'i16': return 'int16_t';
    case 'i32': return 'int32_t';
    case 'i64': return 'int64_t';
    case 'u64': return 'uint64_t';
    case 'bool': return 'bool';
    case 'cstring': return 'const char*';
    case 'void': return 'void';
    default: return 'void*';
  }
}

function cSignature(e: ScriptcableProfile['exports'][number]): string {
  const params: string[] = [];
  for (const p of e.params) {
    if (p === 'string' || p === 'bytes') params.push('const uint8_t*', 'int64_t');
    else params.push(cParamType(p));
  }
  let ret = cParamType(e.returns);
  if (e.returns === 'string' || e.returns === 'bytes') {
    params.push('const uint8_t**', 'int64_t*');
    ret = 'void';
  }
  return `${ret} ${e.symbol}(${params.join(', ')})`;
}

/** napi_value extraction of argv[i] into the hoisted C variables for ABI class cls. */
function cReadArg(cls: AbiClass, i: number, check: string): string {
  const v = `argv[${i}]`;
  switch (cls) {
    case 'f64': return `NAPI_CHECK${check}(napi_get_value_double(env, ${v}, &a${i}));`;
    case 'f32': return `NAPI_CHECK${check}(napi_get_value_double(env, ${v}, &t${i})); a${i} = (float)t${i};`;
    case 'u8': case 'u16': case 'u32':
      return `NAPI_CHECK${check}(napi_get_value_uint32(env, ${v}, &t${i})); a${i} = (${cParamType(cls)})t${i};`;
    case 'i8': case 'i16': case 'i32':
      return `NAPI_CHECK${check}(napi_get_value_int32(env, ${v}, &t${i})); a${i} = (${cParamType(cls)})t${i};`;
    // scriptc ≥ 0.4 exposes i64/u64 as TS number (values proven within
    // ±(2^53 − 1)); accept BigInt too — a lossless caller shouldn't pay for
    // the contract boundary with a type error.
    case 'i64':
      return [
        `napi_valuetype vt${i};`,
        `NAPI_CHECK${check}(napi_typeof(env, ${v}, &vt${i}));`,
        `if (vt${i} == napi_bigint) { NAPI_CHECK${check}(napi_get_value_bigint_int64(env, ${v}, &a${i}, &lossless${i})); }`,
        `else { NAPI_CHECK${check}(napi_get_value_int64(env, ${v}, &a${i})); }`,
      ].join('\n  ');
    case 'u64':
      return [
        `napi_valuetype vt${i};`,
        `NAPI_CHECK${check}(napi_typeof(env, ${v}, &vt${i}));`,
        `if (vt${i} == napi_bigint) { NAPI_CHECK${check}(napi_get_value_bigint_uint64(env, ${v}, &a${i}, &lossless${i})); }`,
        `else { int64_t s${i}; NAPI_CHECK${check}(napi_get_value_int64(env, ${v}, &s${i})); a${i} = (uint64_t)s${i}; }`,
      ].join('\n  ');
    case 'bool': return `NAPI_CHECK${check}(napi_get_value_bool(env, ${v}, &a${i}));`;
    case 'string': case 'cstring':
      // The utf8 buffer is a per-thread, grow-only scratch — malloc/free on
      // every call dominated the string round trip (measured 2026-10-25).
      // _Thread_local keeps worker threads from sharing the buffer. A failed
      // grow leaves cap at 0 so the next call retries (F4).
      return [
        `NAPI_CHECK${check}(napi_get_value_string_utf8(env, ${v}, NULL, 0, &s${i}_len));`,
        `if (s${i}_len + 1 > s${i}_cap) {`,
        `  free(s${i}_buf);`,
        `  s${i}_buf = NULL;`,
        `  s${i}_cap = 0;`,
        `  size_t s${i}_next = s${i}_len + 1 < 256 ? 256 : s${i}_len + 1;`,
        `  char* s${i}_grown = (char*)malloc(s${i}_next);`,
        `  if (s${i}_grown == NULL) { napi_throw_error(env, NULL, "scriptcable addon: out of memory"); goto cleanup; }`,
        `  s${i}_buf = s${i}_grown;`,
        `  s${i}_cap = s${i}_next;`,
        `}`,
        `NAPI_CHECK${check}(napi_get_value_string_utf8(env, ${v}, s${i}_buf, s${i}_cap, &s${i}_len));`,
      ].join('\n  ');
    case 'bytes':
      return `NAPI_CHECK${check}(napi_get_buffer_info(env, ${v}, &s${i}_data, &s${i}_len));`;
    default:
      return `a${i} = NULL;`;
  }
}

/** Builds the per-export wrapper function. Wrappers that allocate use a cleanup label. */
function cWrapper(e: ScriptcableProfile['exports'][number], prefix: string): string {
  // JS-level argument count (a string/bytes param is ONE JS arg but TWO C slots)
  const jsArgc = e.params.length;
  const hasAlloc = e.params.some((p) => p === 'string' || p === 'cstring');
  const check = hasAlloc ? '_GOTO' : '';
  const lines: string[] = [];
  lines.push(`static napi_value ${prefix}${e.export}(napi_env env, napi_callback_info info) {`);
  lines.push(`  size_t argc = ${jsArgc};`);
  lines.push(`  napi_value argv[${Math.max(jsArgc, 1)}];`);
  lines.push(`  napi_value res = NULL;`);

  // Hoisted locals — scalar conversions, bigint lossless flags, alloc slots
  let jsArgIndex = 0;
  const callArgs: string[] = [];
  const frees: string[] = [];
  for (const p of e.params) {
    const i = jsArgIndex;
    if (p === 'string' || p === 'cstring') {
      lines.push(`  static _Thread_local char* s${i}_buf = NULL;`);
      lines.push(`  static _Thread_local size_t s${i}_cap = 0;`);
      lines.push(`  size_t s${i}_len = 0;`);
      callArgs.push(p === 'string' ? `(const uint8_t*)s${i}_buf` : `s${i}_buf`, ...(p === 'string' ? [`(int64_t)s${i}_len`] : []));
      jsArgIndex++;
    } else if (p === 'bytes') {
      lines.push(`  void* s${i}_data = NULL;`);
      lines.push(`  size_t s${i}_len = 0;`);
      callArgs.push(`(const uint8_t*)s${i}_data`, `(int64_t)s${i}_len`);
      jsArgIndex++;
    } else if (p === 'i64' || p === 'u64') {
      lines.push(`  bool lossless${i} = false;`);
      lines.push(`  ${cParamType(p)} a${i} = 0;`);
      callArgs.push(`a${i}`);
      jsArgIndex++;
    } else {
      lines.push(`  ${cParamType(p)} a${i} = 0;`);
      if (p === 'f32') lines.push(`  double t${i} = 0;`);
      else if (['u8', 'u16', 'u32'].includes(p)) lines.push(`  uint32_t t${i} = 0;`);
      else if (['i8', 'i16', 'i32'].includes(p)) lines.push(`  int32_t t${i} = 0;`);
      callArgs.push(`a${i}`);
      jsArgIndex++;
    }
  }

  lines.push(`  NAPI_CHECK${check}(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));`);
  lines.push(`  if (argc != ${jsArgc}) { napi_throw_type_error(env, NULL, "${e.export} expects ${jsArgc} argument${jsArgc === 1 ? '' : 's'}");${hasAlloc ? ' goto cleanup;' : ' return NULL;'} }`);
  jsArgIndex = 0;
  for (const p of e.params) {
    lines.push('  ' + cReadArg(p, jsArgIndex, check));
    jsArgIndex++;
  }

  if (e.returns === 'string' || e.returns === 'bytes') {
    lines.push(`  const uint8_t* out_ptr = NULL;`);
    lines.push(`  int64_t out_len = 0;`);
    lines.push(`  ${e.symbol}(${[...callArgs, '&out_ptr', '&out_len'].join(', ')});`);
    const create =
      e.returns === 'string'
        ? `NAPI_CHECK${check}(napi_create_string_utf8(env, (const char*)out_ptr, (size_t)out_len, &res));`
        : `NAPI_CHECK${check}(napi_create_buffer_copy(env, (size_t)out_len, out_ptr, NULL, &res));`;
    lines.push('  ' + create);
  } else if (e.returns === 'void') {
    lines.push(`  ${e.symbol}(${callArgs.join(', ')});`);
    lines.push(`  NAPI_CHECK${check}(napi_get_undefined(env, &res));`);
  } else if (e.returns === 'cstring') {
    lines.push(`  const char* r = ${e.symbol}(${callArgs.join(', ')});`);
    lines.push(`  NAPI_CHECK${check}(napi_create_string_utf8(env, r, NAPI_AUTO_LENGTH, &res));`);
  } else {
    const cRet = cParamType(e.returns);
    lines.push(`  ${cRet} r = ${e.symbol}(${callArgs.join(', ')});`);
    switch (e.returns) {
      case 'f64': lines.push(`  NAPI_CHECK${check}(napi_create_double(env, r, &res));`); break;
      case 'f32': lines.push(`  NAPI_CHECK${check}(napi_create_double(env, (double)r, &res));`); break;
      case 'bool': lines.push(`  NAPI_CHECK${check}(napi_get_boolean(env, r, &res));`); break;
      // TS-number classes: values are proven within ±(2^53 − 1), so a
      // double carries them exactly
      case 'i64': lines.push(`  NAPI_CHECK${check}(napi_create_double(env, (double)r, &res));`); break;
      case 'u64': lines.push(`  NAPI_CHECK${check}(napi_create_double(env, (double)r, &res));`); break;
      case 'u8': case 'u16': case 'u32': lines.push(`  NAPI_CHECK${check}(napi_create_uint32(env, (uint32_t)r, &res));`); break;
      default: lines.push(`  NAPI_CHECK${check}(napi_create_int32(env, (int32_t)r, &res));`);
    }
  }
  if (hasAlloc) {
    lines.push('cleanup:');
    for (const f of frees) lines.push('  ' + f);
    lines.push('  return res;');
  } else {
    lines.push('  return res;');
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * The addon's batch executive is registered under a name no TS export can
 * realistically take; if one does, the executive is skipped entirely and
 * clients fall back to their sequential batch loop (they probe with typeof).
 */
export const BATCH_SYMBOL = '__scriptcable_batch';

/**
 * Every C symbol the batch executive defines — the single source of truth
 * for the collision guard below. The source test in napi-addon.test.ts
 * asserts the generated executive never defines/uses a symbol outside this
 * list, so a new helper can't silently re-open the F-2 collision.
 */
export const BATCH_EXEC_SYMBOLS = [
  '__sc_batch',
  '__sc_bres_buf',
  '__sc_bres_cap',
  '__sc_bres_used',
  '__sc_bres_reserve',
  '__sc_bres_u32',
  '__sc_bres_u64',
  '__sc_bres_f64',
  '__sc_bres_mem',
] as const;

/** Result kinds — the wire contract shared with packages/core/src/batch-wire.ts. */
const BATCH_KINDS_H = `/* batch wire result kinds — mirror packages/core/src/batch-wire.ts */
#define __SC_BK_F64 1
#define __SC_BK_BOOL 2
#define __SC_BK_U32 3
#define __SC_BK_I32 4
#define __SC_BK_I64 5
#define __SC_BK_U64 6
#define __SC_BK_STRING 7
#define __SC_BK_BYTES 8
#define __SC_BK_CSTRING 9
#define __SC_BK_VOID 10
`;

/** Grow-only per-thread result block — one Buffer copy back to JS per batch. */
const BATCH_HELPERS_C = `
static _Thread_local uint8_t* __sc_bres_buf = NULL;
static _Thread_local size_t __sc_bres_cap = 0;
static _Thread_local size_t __sc_bres_used = 0;

static int __sc_bres_reserve(size_t extra) {
  if (__sc_bres_used + extra <= __sc_bres_cap) return 1;
  size_t next = __sc_bres_cap ? __sc_bres_cap : 256;
  while (next < __sc_bres_used + extra) next *= 2;
  uint8_t* grown = (uint8_t*)realloc(__sc_bres_buf, next);
  if (grown == NULL) return 0; /* cap stays — the next batch retries */
  __sc_bres_buf = grown;
  __sc_bres_cap = next;
  return 1;
}

static int __sc_bres_u32(uint32_t v) {
  if (!__sc_bres_reserve(4)) return 0;
  memcpy(__sc_bres_buf + __sc_bres_used, &v, 4);
  __sc_bres_used += 4;
  return 1;
}

static int __sc_bres_u64(uint64_t v) {
  if (!__sc_bres_reserve(8)) return 0;
  memcpy(__sc_bres_buf + __sc_bres_used, &v, 8);
  __sc_bres_used += 8;
  return 1;
}

static int __sc_bres_f64(double v) {
  if (!__sc_bres_reserve(8)) return 0;
  memcpy(__sc_bres_buf + __sc_bres_used, &v, 8);
  __sc_bres_used += 8;
  return 1;
}

static int __sc_bres_mem(const void* p, size_t n) {
  if (!__sc_bres_reserve(n)) return 0;
  memcpy(__sc_bres_buf + __sc_bres_used, p, n);
  __sc_bres_used += n;
  return 1;
}
`;

/**
 * The host shared library's batch executive rides a fixed C symbol. A core
 * whose own export symbol collides with it loses the TU (clients fall back
 * to their sequential loop) — same fence-as-guard policy as the addon.
 */
export const SHARED_BATCH_SYMBOL = 'scriptc_batch';

/** Run one batch entry of this export: parse slots, call, emit the result. */
function cBatchEntry(e: ScriptcableProfile['exports'][number], idx: number): string {
  const slotBytes = e.params.length * 8;
  const lines: string[] = [];
  lines.push(`/* batch entry ${idx} — export ${JSON.stringify(e.export)} */`);
  lines.push(`static int __sc_bentry_${idx}(const uint8_t* args, size_t args_len, size_t arg_base) {`);
  lines.push(`  if (arg_base + ${slotBytes} > args_len) return 0;`);

  const callArgs: string[] = [];
  for (let i = 0; i < e.params.length; i++) {
    const cls = e.params[i]!;
    const slot = `arg_base + ${i * 8}`;
    if (cls === 'f64') {
      lines.push(`  double d${i}; memcpy(&d${i}, args + ${slot}, 8);`);
      callArgs.push(`d${i}`);
    } else if (cls === 'f32') {
      lines.push(`  double d${i}; memcpy(&d${i}, args + ${slot}, 8);`);
      callArgs.push(`(float)d${i}`);
    } else if (cls === 'bool') {
      lines.push(`  double d${i}; memcpy(&d${i}, args + ${slot}, 8);`);
      callArgs.push(`(d${i} != 0.0)`);
    } else if (cls === 'i64' || cls === 'u64') {
      lines.push(`  ${cParamType(cls)} v${i}; memcpy(&v${i}, args + ${slot}, 8);`);
      callArgs.push(`v${i}`);
    } else if (cls === 'string' || cls === 'bytes' || cls === 'cstring') {
      lines.push(`  uint32_t o${i}; uint32_t l${i};`);
      lines.push(`  memcpy(&o${i}, args + ${slot}, 4); memcpy(&l${i}, args + ${slot} + 4, 4);`);
      lines.push(`  if ((size_t)o${i} + (size_t)l${i} > args_len) return 0;`);
      if (cls === 'cstring') {
        // The core reads cstrings with strlen — require the declared region
        // to actually end at NUL so a forged slot can't walk past the buffer.
        lines.push(`  if (l${i} == 0 || args[o${i} + l${i} - 1] != 0) return 0;`);
        callArgs.push(`(const char*)(args + o${i})`);
      } else {
        callArgs.push(`(const uint8_t*)(args + o${i})`, `(int64_t)l${i}`);
      }
    } else if (['u8', 'u16', 'u32', 'i8', 'i16', 'i32'].includes(cls)) {
      lines.push(`  double d${i}; memcpy(&d${i}, args + ${slot}, 8);`);
      callArgs.push(`(${cParamType(cls)})d${i}`);
    } else {
      lines.push(`  void* p${i} = NULL;`);
      callArgs.push(`p${i}`);
    }
  }

  switch (e.returns) {
    case 'string':
    case 'bytes': {
      lines.push(`  const uint8_t* out_ptr = NULL;`);
      lines.push(`  int64_t out_len = 0;`);
      lines.push(`  ${e.symbol}(${[...callArgs, '&out_ptr', '&out_len'].join(', ')});`);
      lines.push(`  if (!__sc_bres_u32(${e.returns === 'string' ? '__SC_BK_STRING' : '__SC_BK_BYTES'})) return -1;`);
      lines.push(`  if (!__sc_bres_u32((uint32_t)out_len)) return -1;`);
      lines.push(`  if (out_len > 0 && !__sc_bres_mem(out_ptr, (size_t)out_len)) return -1;`);
      break;
    }
    case 'cstring':
      lines.push(`  const char* r = ${e.symbol}(${callArgs.join(', ')});`);
      lines.push(`  size_t rlen = r ? strlen(r) : 0;`);
      lines.push(`  if (!__sc_bres_u32(__SC_BK_CSTRING)) return -1;`);
      lines.push(`  if (!__sc_bres_u32((uint32_t)rlen)) return -1;`);
      lines.push(`  if (rlen > 0 && !__sc_bres_mem(r, rlen)) return -1;`);
      break;
    case 'void':
      lines.push(`  ${e.symbol}(${callArgs.join(', ')});`);
      lines.push(`  if (!__sc_bres_u32(__SC_BK_VOID)) return -1;`);
      break;
    case 'bool': {
      lines.push(`  bool r = ${e.symbol}(${callArgs.join(', ')});`);
      lines.push(`  if (!__sc_bres_u32(__SC_BK_BOOL)) return -1;`);
      lines.push(`  if (!__sc_bres_u32(r ? 1u : 0u)) return -1;`);
      break;
    }
    case 'f64': {
      lines.push(`  double r = ${e.symbol}(${callArgs.join(', ')});`);
      lines.push(`  if (!__sc_bres_u32(__SC_BK_F64)) return -1;`);
      lines.push(`  if (!__sc_bres_f64(r)) return -1;`);
      break;
    }
    case 'f32': {
      lines.push(`  float r = ${e.symbol}(${callArgs.join(', ')});`);
      lines.push(`  if (!__sc_bres_u32(__SC_BK_F64)) return -1;`);
      lines.push(`  if (!__sc_bres_f64((double)r)) return -1;`);
      break;
    }
    case 'i64':
    case 'u64': {
      lines.push(`  ${cParamType(e.returns)} r = ${e.symbol}(${callArgs.join(', ')});`);
      lines.push(`  if (!__sc_bres_u32(${e.returns === 'i64' ? '__SC_BK_I64' : '__SC_BK_U64'})) return -1;`);
      lines.push(`  if (!__sc_bres_u64((uint64_t)r)) return -1;`);
      break;
    }
    case 'u8':
    case 'u16':
    case 'u32': {
      lines.push(`  ${cParamType(e.returns)} r = ${e.symbol}(${callArgs.join(', ')});`);
      lines.push(`  if (!__sc_bres_u32(__SC_BK_U32)) return -1;`);
      lines.push(`  if (!__sc_bres_u32((uint32_t)r)) return -1;`);
      break;
    }
    default: {
      lines.push(`  int32_t r = ${e.symbol}(${callArgs.join(', ')});`);
      lines.push(`  if (!__sc_bres_u32(__SC_BK_I32)) return -1;`);
      lines.push(`  if (!__sc_bres_u32((uint32_t)(int32_t)r)) return -1;`);
    }
  }
  lines.push(`  return 1;`);
  lines.push(`}`);
  return lines.join('\n');
}

/**
 * C source for the batch executive: N core calls across one boundary. The
 * wire layout is documented in packages/core/src/batch-wire.ts. Empty string
 * when the profile already exports the executive's name (clients then use
 * their sequential fallback).
 */
/** Entry runners shared by the addon executive and the host (.so) TU. */
function cBatchEntries(profile: ScriptcableProfile): string {
  return profile.exports.map((e, idx) => cBatchEntry(e, idx)).join('\n\n');
}

export function generateBatchExecutiveSource(profile: ScriptcableProfile): string {
  if (profile.exports.some((e) => e.export === BATCH_SYMBOL)) return '';
  // Every export also becomes a C wrapper named `__sc_<export>` — if that
  // name would collide with an executive symbol, SKIP the executive rather
  // than emit a TU that redefines it (the addon's soft-fail would otherwise
  // kill the whole typed binding, not just batch). Exports can spell any
  // C identifier, so the guard — not an exotic rename — is the real fence.
  const wrapperNames = profile.exports.map((e) => `__sc_${e.export}`);
  if (
    wrapperNames.some((n) => (BATCH_EXEC_SYMBOLS as readonly string[]).includes(n) || /^__sc_bentry_\d+$/.test(n))
  ) {
    return '';
  }
  const entries = cBatchEntries(profile);
  const dispatch = profile.exports
    .map((e, idx) => `      case ${idx}: ok = __sc_bentry_${idx}(args, args_len, arg_base); break;`)
    .join('\n');
  return `
/* ---- batch executive: N calls across one boundary (wire: batch-wire.ts) ---- */
${BATCH_KINDS_H}
${BATCH_HELPERS_C}
${entries}

static napi_value __sc_batch(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_value res = NULL;
  napi_typedarray_type meta_type, args_type;
  size_t meta_len = 0, args_len = 0;
  void* meta_data = NULL;
  void* args_data = NULL;
  NAPI_CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc != 2) { napi_throw_type_error(env, NULL, "batch expects (meta Int32Array, args Uint8Array)"); return NULL; }
  NAPI_CHECK(napi_get_typedarray_info(env, argv[0], &meta_type, &meta_len, &meta_data, NULL, NULL));
  NAPI_CHECK(napi_get_typedarray_info(env, argv[1], &args_type, &args_len, &args_data, NULL, NULL));
  if (meta_type != napi_int32_array || args_type != napi_uint8_array) {
    napi_throw_type_error(env, NULL, "batch wire must be (Int32Array, Uint8Array)");
    return NULL;
  }
  const int32_t* meta = (const int32_t*)meta_data;
  const uint8_t* args = (const uint8_t*)args_data;
  int32_t count = meta_len > 0 ? meta[0] : 0;
  if (count < 0 || (size_t)count > (meta_len - 1) / 2) {
    napi_throw_range_error(env, NULL, "batch meta count out of bounds");
    return NULL;
  }
  __sc_bres_used = 0;
  for (int32_t i = 0; i < count; i++) {
    int32_t idx = meta[1 + 2 * i];
    size_t arg_base = (size_t)(uint32_t)meta[2 + 2 * i];
    if (idx < 0 || idx >= ${profile.exports.length}) {
      napi_throw_range_error(env, NULL, "batch meta export index out of range");
      return NULL;
    }
    int ok;
    switch (idx) {
${dispatch}
      default: napi_throw_range_error(env, NULL, "batch meta export index out of range"); return NULL;
    }
    if (ok == 0) { napi_throw_range_error(env, NULL, "batch wire bounds violation (arg_base or payload offset)"); return NULL; }
    if (ok < 0) { napi_throw_error(env, NULL, "scriptcable batch: out of memory"); return NULL; }
  }
  NAPI_CHECK(napi_create_buffer_copy(env, __sc_bres_used, __sc_bres_buf ? __sc_bres_buf : (const uint8_t*)"", NULL, &res));
  return res;
}
`;
}

/**
 * C source for the HOST shared library's batch executive — same wire and
 * entry runners as the addon executive, but a plain C entry (no N-API), so
 * bun:ffi/koffi hosts (Node/Windows without the addon) get one-crossing
 * batches too. Linked into the host .so only (android's version script only
 * exports Java_*, which would localize the executive symbol into uselessness).
 *
 * Returns >0 = result block size in bytes (per-thread grow-only block, valid
 * until the next batch call on this thread — JS decodes immediately), or
 * negative: -1 wire error, -2 bounds violation, -3 out of memory.
 */
export function generateSharedBatchSource(profile: ScriptcableProfile): string {
  // The TU defines the same helpers and entry runners as the addon executive
  // — a core symbol colliding with ANY of them (or with the entry symbol) must
  // drop the TU, or the compile failure would hard-fail the whole build
  // (the addon path soft-skips at the toolchain; this one cannot).
  if (profile.exports.length === 0) return '';
  const symbols = profile.exports.map((e) => e.symbol);
  if (
    symbols.includes(SHARED_BATCH_SYMBOL) ||
    symbols.some(
      (s) =>
        ((BATCH_EXEC_SYMBOLS as readonly string[]).includes(s) && s !== '__sc_batch') ||
        /^__sc_bentry_\d+$/.test(s),
    )
  ) {
    return '';
  }
  const entries = cBatchEntries(profile);
  const externs = profile.exports.map((e) => `extern ${cSignature(e)};`).join('\n');
  const dispatch = profile.exports
    .map((e, idx) => `      case ${idx}: ok = __sc_bentry_${idx}(args, args_len, arg_base); break;`)
    .join('\n');
  return `
/* ---- host batch executive: N calls across one boundary (wire: batch-wire.ts) ---- */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

${BATCH_KINDS_H}
${BATCH_HELPERS_C}
${externs}
${entries}

int64_t ${SHARED_BATCH_SYMBOL}(const int32_t* meta, int64_t meta_elems, const uint8_t* args, int64_t args_len, uint8_t** out_block) {
  int32_t count = meta_elems > 0 ? meta[0] : 0;
  if (count < 0 || (size_t)count > (size_t)(meta_elems - 1) / 2) return -1;
  __sc_bres_used = 0;
  for (int32_t i = 0; i < count; i++) {
    int32_t idx = meta[1 + 2 * i];
    size_t arg_base = (size_t)(uint32_t)meta[2 + 2 * i];
    if (idx < 0 || idx >= ${profile.exports.length}) return -1;
    int ok;
    switch (idx) {
${dispatch}
      default: return -1;
    }
    if (ok == 0) return -2;
    if (ok < 0) return -3;
  }
  *out_block = __sc_bres_buf ? __sc_bres_buf : (uint8_t*)"";
  return (int64_t)__sc_bres_used;
}
`;
}

/** Emit the full C source for the typed N-API addon wrapping this profile. */
export function generateNodeAddonSource(profile: ScriptcableProfile): string {
  const externs = profile.exports.map((e) => `extern ${cSignature(e)};`).join('\n');
  const wrappers = profile.exports.map((e) => cWrapper(e, '__sc_')).join('\n\n');
  const batch = generateBatchExecutiveSource(profile);
  const batchRegister = batch
    ? [
        `  NAPI_CHECK(napi_create_function(env, "${BATCH_SYMBOL}", NAPI_AUTO_LENGTH, __sc_batch, NULL, &fn));`,
        `  NAPI_CHECK(napi_set_named_property(env, exports, "${BATCH_SYMBOL}", fn));`,
      ].join('\n')
    : '';
  const registrations = profile.exports
    .map(
      (e) =>
        `  NAPI_CHECK(napi_create_function(env, ${JSON.stringify(e.export)}, NAPI_AUTO_LENGTH, __sc_${e.export}, NULL, &fn));\n` +
        `  NAPI_CHECK(napi_set_named_property(env, exports, ${JSON.stringify(e.export)}, fn));`,
    )
    .join('\n');
  const needsGoto = profile.exports.some((e) => e.params.some((p) => p === 'string' || p === 'cstring'));
  const gotoMacro = needsGoto
    ? `
#define NAPI_CHECK_GOTO(call) do { \\
  napi_status __st = (call); \\
  if (__st != napi_ok) { napi_throw_error(env, NULL, "scriptcable addon: " #call " failed"); goto cleanup; } \\
} while (0)
`
    : '';

  return `/*
 * Generated by scriptcable — typed N-API direct binding for the "${profile.name}" core.
 * Each export has a fixed C signature matching the compiled ABI, so calls
 * cross the thinnest possible JS↔native boundary (no dynamic marshalling).
 */
#include <node_api.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>

#define NAPI_CHECK(call) do { \\
  napi_status __st = (call); \\
  if (__st != napi_ok) { napi_throw_error(env, NULL, "scriptcable addon: " #call " failed"); return NULL; } \\
} while (0)
${gotoMacro}
${externs}
extern void ${profile.abi.init_symbol}(void);

${wrappers}
${batch}
NAPI_MODULE_INIT() {
  napi_value fn;
  ${profile.abi.init_symbol}();
${registrations}
${batchRegister}
  return exports;
}
`;
}

async function run(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.stdout.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stderr }));
  });
}

/** Locate node-api-headers' include dir relative to this package. */
function resolveNodeApiInclude(): string {
  const req = createRequire(import.meta.url);
  const pkgDir = dirname(req.resolve('node-api-headers/package.json'));
  return join(pkgDir, 'include');
}

export type BuildNodeAddonOptions = {
  /** Path to scriptc .lib.a */
  archivePath: string;
  /** Output directory (the addon lands at <outDir>/<name>.node) */
  outDir: string;
  name: string;
  profile: ScriptcableProfile;
};

/**
 * Compile the typed addon. Throws ScriptcableToolchainError on failure —
 * callers treat that as "skip the addon" (warn + continue).
 */
export async function buildNodeAddon(options: BuildNodeAddonOptions): Promise<string> {
  const archivePath = resolve(options.archivePath);
  const outDir = resolve(options.outDir);
  const outPath = join(outDir, napiAddonFileName(options.name));
  const include = resolveNodeApiInclude();

  const clang = (await which('clang')) ?? (await which('cc'));
  if (!clang) throw new ScriptcableToolchainError('clang/cc is required for the N-API addon build.');

  await mkdir(outDir, { recursive: true });
  const wrapperC = join(outDir, `${options.name}-napi.c`);
  await writeFile(wrapperC, generateNodeAddonSource(options.profile));
  const stubC = join(outDir, 'scriptcable-napi-stubs.c');
  const stubO = join(outDir, 'scriptcable-napi-stubs.o');
  await writeFile(stubC, STUB_SOURCE);

  const c1 = await run(clang, ['-c', stubC, '-o', stubO, '-I', include]);
  if (c1.code !== 0) throw new ScriptcableToolchainError(`N-API addon stub compile failed:\n${c1.stderr}`);

  const args = ['-shared', '-o', outPath, '-I', include, wrapperC, stubO];
  if (process.platform === 'darwin') {
    args.push('-Wl,-force_load,' + archivePath, '-Wl,-undefined,dynamic_lookup');
  } else {
    args.push('-fPIC', '-Wl,--whole-archive', archivePath, '-Wl,--no-whole-archive', '-Wl,--allow-shlib-undefined');
  }
  args.push('-lm', '-lpthread');
  if (process.platform === 'linux') args.push('-ldl');

  const link = await run(clang, args);
  if (link.code !== 0) {
    throw new ScriptcableToolchainError(
      `Failed to link the typed N-API addon:\n${link.stderr}`,
      'The shared library (generic FFI) path is unaffected — clients fall back automatically.',
    );
  }
  return outPath;
}
