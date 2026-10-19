/**
 * Load a scriptc native shared library and call C ABI exports.
 * Bun → bun:ffi; Node → koffi.
 */
import type { AbiClass, ExportDef, ScriptcaProfile } from '@scriptca/types';
import { ScriptcaError } from '@scriptca/types';
import { readFile } from 'node:fs/promises';
import { sharedLibraryFileName } from './link-shared.js';

export type NativeModule = {
  profile: ScriptcaProfile;
  call: (exportName: string, ...args: unknown[]) => unknown;
  dispose: () => void;
};

type FfiBinding = {
  call: (symbol: string, args: unknown[]) => unknown;
  close?: () => void;
};

function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

async function bindBun(soPath: string, profile: ScriptcaProfile): Promise<FfiBinding> {
  const { dlopen, FFIType, ptr, toArrayBuffer } = await import('bun:ffi');

  const mapClass = (c: AbiClass): unknown => {
    const m: Record<string, unknown> = {
      f64: FFIType.f64,
      f32: FFIType.f32,
      bool: FFIType.bool,
      u8: FFIType.u8,
      u16: FFIType.u16,
      u32: FFIType.u32,
      i8: FFIType.i8,
      i16: FFIType.i16,
      i32: FFIType.i32,
      i64: FFIType.i64,
      u64: FFIType.u64,
      void: FFIType.void,
    };
    return m[c] ?? FFIType.ptr;
  };

  const symbols: Record<string, { args: unknown[]; returns: unknown }> = {
    [profile.abi.init_symbol]: { args: [], returns: FFIType.void },
  };

  for (const e of profile.exports) {
    const args: unknown[] = [];
    for (const p of e.params) {
      if (p === 'string' || p === 'bytes') args.push(FFIType.ptr, FFIType.i64);
      else if (p === 'cstring') args.push(FFIType.ptr);
      else args.push(mapClass(p));
    }
    let returns: unknown = mapClass(e.returns);
    if (e.returns === 'string' || e.returns === 'bytes') {
      args.push(FFIType.ptr, FFIType.ptr);
      returns = FFIType.void;
    } else if (e.returns === 'cstring') {
      returns = FFIType.ptr;
    }
    symbols[e.symbol] = { args, returns };
  }

  const lib = dlopen(soPath, symbols);
  const sym = lib.symbols as Record<string, (...args: never[]) => unknown>;
  const init = sym[profile.abi.init_symbol];
  if (typeof init === 'function') (init as () => void)();

  return {
    call(symbol, args) {
      const def = profile.exports.find((x) => x.symbol === symbol);
      if (!def) throw new ScriptcaError('MISSING_EXPORT', symbol);
      const fn = sym[symbol];
      if (typeof fn !== 'function') throw new ScriptcaError('MISSING_EXPORT', symbol);
      return invokeNative(fn, def, args, {
        ptr: (buf) => ptr(buf),
        readBytes: (addr, len) => new Uint8Array(toArrayBuffer(addr, 0, len)),
      });
    },
  };
}

async function bindKoffi(soPath: string, profile: ScriptcaProfile): Promise<FfiBinding> {
  let koffiMod: typeof import('koffi');
  try {
    koffiMod = await import('koffi');
  } catch {
    throw new ScriptcaError(
      'MISSING_DEP',
      'koffi is required to load native scriptca libraries under Node.js.',
      'Install it: npm install koffi\n(Bun uses built-in bun:ffi and does not need koffi.)',
    );
  }
  const koffi = koffiMod.default ?? koffiMod;
  const lib = koffi.load(soPath);
  const funcs: Record<string, (...args: unknown[]) => unknown> = {};

  lib.func(`void ${profile.abi.init_symbol}()`)();

  for (const e of profile.exports) {
    funcs[e.symbol] = makeKoffiFunc(koffi, lib, e);
  }

  return {
    call(symbol, args) {
      const fn = funcs[symbol];
      if (!fn) throw new ScriptcaError('MISSING_EXPORT', symbol);
      return fn(...args);
    },
  };
}

function koffiClass(c: AbiClass): string {
  switch (c) {
    case 'f64':
      return 'double';
    case 'f32':
      return 'float';
    case 'bool':
      return 'bool';
    case 'u8':
      return 'uint8_t';
    case 'u16':
      return 'uint16_t';
    case 'u32':
      return 'uint32_t';
    case 'i8':
      return 'int8_t';
    case 'i16':
      return 'int16_t';
    case 'i32':
      return 'int32_t';
    case 'i64':
      return 'int64_t';
    case 'u64':
      return 'uint64_t';
    case 'void':
      return 'void';
    case 'cstring':
      return 'const char *';
    default:
      return 'void *';
  }
}

function makeKoffiFunc(
  koffi: { decode: (ptr: unknown, type: string, len?: number) => unknown },
  lib: { func: (sig: string) => (...args: unknown[]) => unknown },
  e: ExportDef,
): (...args: unknown[]) => unknown {
  const argParts: string[] = [];
  for (const p of e.params) {
    if (p === 'string' || p === 'bytes') argParts.push('const uint8_t *', 'int64_t');
    else if (p === 'cstring') argParts.push('const char *');
    else argParts.push(koffiClass(p));
  }
  let ret = koffiClass(e.returns);
  if (e.returns === 'string' || e.returns === 'bytes') {
    argParts.push('_Out_ void **', '_Out_ size_t *');
    ret = 'void';
  }
  const raw = lib.func(`${ret} ${e.symbol}(${argParts.join(', ')})`);

  return (...args: unknown[]) => {
    const ffiArgs: unknown[] = [];
    for (let i = 0; i < e.params.length; i++) {
      const cls = e.params[i]!;
      const v = args[i];
      if (cls === 'string') {
        const buf = Buffer.from(String(v ?? ''), 'utf8');
        ffiArgs.push(buf, buf.byteLength);
      } else if (cls === 'bytes') {
        const buf = v instanceof Uint8Array ? Buffer.from(v) : Buffer.from(v as ArrayBuffer);
        ffiArgs.push(buf, buf.byteLength);
      } else if (cls === 'cstring') {
        ffiArgs.push(String(v ?? ''));
      } else if (cls === 'bool') {
        ffiArgs.push(Boolean(v));
      } else {
        ffiArgs.push(v);
      }
    }
    if (e.returns === 'string' || e.returns === 'bytes') {
      const out: unknown[] = [null];
      const outLen: (number | bigint)[] = [0];
      ffiArgs.push(out, outLen);
      raw(...ffiArgs);
      const len = Number(outLen[0]);
      const decoded = koffi.decode(out[0], 'uint8_t', len) as number[] | Uint8Array;
      const bytes = decoded instanceof Uint8Array ? decoded : Uint8Array.from(decoded);
      return e.returns === 'string' ? Buffer.from(bytes).toString('utf8') : bytes.slice();
    }
    return raw(...ffiArgs);
  };
}

type PtrHelpers = {
  ptr: (buf: ArrayBufferView | ArrayBuffer) => unknown;
  readBytes: (addr: number | bigint, len: number) => Uint8Array;
};

function invokeNative(
  fn: (...a: never[]) => unknown,
  def: ExportDef,
  args: unknown[],
  helpers: PtrHelpers,
): unknown {
  const ffiArgs: never[] = [];
  const keepAlive: ArrayBufferView[] = [];

  for (let i = 0; i < def.params.length; i++) {
    const cls = def.params[i]!;
    const v = args[i];
    if (cls === 'string' || cls === 'bytes') {
      const buf =
        cls === 'string'
          ? Buffer.from(String(v ?? ''), 'utf8')
          : v instanceof Uint8Array
            ? Buffer.from(v)
            : Buffer.from(v as ArrayBuffer);
      keepAlive.push(buf);
      ffiArgs.push(helpers.ptr(buf) as never, BigInt(buf.byteLength) as never);
    } else if (cls === 'cstring') {
      const buf = Buffer.from(String(v ?? '') + '\0', 'utf8');
      keepAlive.push(buf);
      ffiArgs.push(helpers.ptr(buf) as never);
    } else if (cls === 'bool') {
      ffiArgs.push((v ? 1 : 0) as never);
    } else {
      ffiArgs.push(v as never);
    }
  }

  if (def.returns === 'string' || def.returns === 'bytes') {
    const outPtr = new BigUint64Array(1);
    const outLen = new BigUint64Array(1);
    keepAlive.push(outPtr, outLen);
    ffiArgs.push(helpers.ptr(outPtr) as never, helpers.ptr(outLen) as never);
    fn(...ffiArgs);
    const bytes = helpers.readBytes(outPtr[0]!, Number(outLen[0]));
    return def.returns === 'string' ? new TextDecoder().decode(bytes) : bytes.slice();
  }

  if (def.returns === 'void') {
    fn(...ffiArgs);
    return undefined;
  }
  if (def.returns === 'bool') return Boolean(fn(...ffiArgs));
  return fn(...ffiArgs);
}

export async function loadNativeLibrary(
  sharedPath: string,
  profile: ScriptcaProfile,
): Promise<NativeModule> {
  const binding = isBun() ? await bindBun(sharedPath, profile) : await bindKoffi(sharedPath, profile);
  const byName = new Map(profile.exports.map((e) => [e.export, e]));

  return {
    profile,
    call(exportName: string, ...args: unknown[]) {
      const def = byName.get(exportName);
      if (!def) {
        throw new ScriptcaError(
          'UNKNOWN_EXPORT',
          `Unknown export "${exportName}"`,
          `Known: ${[...byName.keys()].join(', ')}`,
        );
      }
      return binding.call(def.symbol, args);
    },
    dispose() {
      binding.close?.();
    },
  };
}

export async function loadNativeFromOutDir(outDir: string): Promise<NativeModule> {
  const profile = JSON.parse(await readFile(`${outDir}/profile.json`, 'utf8')) as ScriptcaProfile;
  const soPath = `${outDir}/${sharedLibraryFileName(profile.name)}`;
  return loadNativeLibrary(soPath, profile);
}
