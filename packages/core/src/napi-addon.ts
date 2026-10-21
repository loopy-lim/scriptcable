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
    case 'bool': return `NAPI_CHECK${check}(napi_get_value_boolean(env, ${v}, &a${i}));`;
    case 'string': case 'cstring':
      return [
        `NAPI_CHECK${check}(napi_get_value_string_utf8(env, ${v}, NULL, 0, &s${i}_len));`,
        `s${i} = (char*)malloc(s${i}_len + 1);`,
        `if (s${i} == NULL) { napi_throw_error(env, NULL, "scriptcable addon: out of memory"); goto cleanup; }`,
        `NAPI_CHECK${check}(napi_get_value_string_utf8(env, ${v}, s${i}, s${i}_len + 1, &s${i}_len));`,
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
      lines.push(`  char* s${i} = NULL;`);
      lines.push(`  size_t s${i}_len = 0;`);
      frees.push(`free(s${i});`);
      callArgs.push(p === 'string' ? `(const uint8_t*)s${i}` : `s${i}`, ...(p === 'string' ? [`(int64_t)s${i}_len`] : []));
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

/** Emit the full C source for the typed N-API addon wrapping this profile. */
export function generateNodeAddonSource(profile: ScriptcableProfile): string {
  const externs = profile.exports.map((e) => `extern ${cSignature(e)};`).join('\n');
  const wrappers = profile.exports.map((e) => cWrapper(e, '__sc_')).join('\n\n');
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

NAPI_MODULE_INIT() {
  napi_value fn;
  ${profile.abi.init_symbol}();
${registrations}
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
