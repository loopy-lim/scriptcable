/**
 * Load a scriptc native shared library and call C ABI exports.
 * Bun → bun:ffi (default engine, built-in); plain Node → optional koffi fallback.
 */
import type { AbiClass, ExportDef, ScriptcableProfile } from '@scriptcable/types';
import { ScriptcableError } from '@scriptcable/types';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { sharedLibraryFileName } from './link-shared.js';

export type NativeModule = {
  profile: ScriptcableProfile;
  call: (exportName: string, ...args: unknown[]) => unknown;
  /**
   * Per-export pre-bound functions keyed by TypeScript export name —
   * skips the name lookup + argument-array dispatch of `call`. Number-only
   * signatures bind the FFI symbol directly; the rest reuse the same
   * marshaling as `call`.
   */
  fns: Record<string, (...args: unknown[]) => unknown>;
  dispose: () => void;
};

type FfiBinding = {
  call: (symbol: string, args: unknown[]) => unknown;
  /** Pre-bound per-export functions keyed by export name (see NativeModule.fns). */
  fns: Record<string, (...args: unknown[]) => unknown>;
  close?: () => void;
};

function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

async function bindBun(soPath: string, profile: ScriptcableProfile): Promise<FfiBinding> {
  return bindBunSync(soPath, profile, await import('bun:ffi'));
}

/** Same binding as `bindBun`, given the already-loaded bun:ffi module. */
function bindBunSync(soPath: string, profile: ScriptcableProfile, ffi: typeof import('bun:ffi')): FfiBinding {
  const { dlopen, FFIType, ptr, toArrayBuffer } = ffi;

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

  const helpers: PtrHelpers = {
    ptr: (buf) => ptr(buf),
    readBytes: (addr, len) => new Uint8Array(toArrayBuffer(addr, 0, len)),
  };
  const scratch = makeMarshalScratch(helpers);
  const fns: Record<string, (...args: unknown[]) => unknown> = {};
  for (const e of profile.exports) {
    const fn = sym[e.symbol];
    if (typeof fn !== 'function') {
      fns[e.export] = () => {
        throw new ScriptcableError('MISSING_EXPORT', e.symbol);
      };
    } else if (hasDirectFfiSignature(e)) {
      fns[e.export] = makeDirectFfiFn(fn, e);
    } else {
      fns[e.export] = makeMarshaledFfiFn(fn, e, scratch, helpers);
    }
  }

  return {
    call(symbol, args) {
      const def = profile.exports.find((x) => x.symbol === symbol);
      if (!def) throw new ScriptcableError('MISSING_EXPORT', symbol);
      // Same fast path as fns — the per-export closure carries the scratch
      // and slot layout, so the universal entry pays no dispatch penalty.
      return fns[def.export]!(...args);
    },
    fns,
  };
}

type KoffiModule = typeof import('koffi');

const KOFFI_HINT =
  'Bun is the default engine and loads native libraries with built-in bun:ffi — no extra dependency.\n' +
  'Node fallback only: npm install koffi';

async function bindKoffi(soPath: string, profile: ScriptcableProfile): Promise<FfiBinding> {
  let koffiMod: KoffiModule;
  try {
    koffiMod = await import('koffi');
  } catch {
    throw new ScriptcableError(
      'MISSING_DEP',
      'koffi is an optional fallback for running scriptcable native libraries under plain Node.js.',
      KOFFI_HINT,
    );
  }
  return bindKoffiSync(soPath, profile, koffiMod);
}

/** Same binding as `bindKoffi`, given the already-loaded koffi module. */
function bindKoffiSync(soPath: string, profile: ScriptcableProfile, koffiMod: KoffiModule): FfiBinding {
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
      if (!fn) throw new ScriptcableError('MISSING_EXPORT', symbol);
      return fn(...args);
    },
    // koffi's funcs already marshal per export — re-key them by export name.
    fns: Object.fromEntries(profile.exports.map((e) => [e.export, funcs[e.symbol]!])),
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
): (...args: unknown[]) => unknown {  const argParts: string[] = [];
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

/**
 * Per-binding marshaling scratch shared across calls. The native path has no
 * JS callbacks (re-entrancy exists only in the WASM loader, which keeps its
 * own depth guard), and calls are synchronous — so one scratch buffer, one
 * out-slot pair, and one encoder/decoder are safe and remove the per-call
 * allocations the marshaling path used to pay for every invocation.
 */
type MarshalScratch = {
  encoder: TextEncoder;
  decoder: TextDecoder;
  buf: Uint8Array;
  /** Bump cursor into `buf` — each parameter carves its own region (F3). */
  used: number;
  /** Buffers replaced mid-call whose pointers may already sit in ffi args — kept alive until the call ends. */
  retired: ArrayBufferView[];
  outPtr: BigUint64Array;
  outLen: BigUint64Array;
  outPtrArg: unknown;
  outLenArg: unknown;
};

const cstrDecoder = new TextDecoder();

function makeMarshalScratch(helpers: PtrHelpers): MarshalScratch {
  const outPtr = new BigUint64Array(1);
  const outLen = new BigUint64Array(1);
  return {
    encoder: new TextEncoder(),
    decoder: new TextDecoder(),
    buf: new Uint8Array(1024),
    used: 0,
    retired: [],
    outPtr,
    outLen,
    outPtrArg: helpers.ptr(outPtr),
    outLenArg: helpers.ptr(outLen),
  };
}

/** Bump-allocate `size` bytes in the scratch, growing it (never mid-call-freeing) when needed. */
function bumpScratch(st: MarshalScratch, size: number): number {
  const n = size || 1;
  st.used = (st.used + 15) & ~15;
  if (st.used + n > st.buf.byteLength) {
    // A grown buffer leaves pointers (from earlier parameters of this call)
    // pointing into the old one — keep it alive until the call ends instead
    // of letting GC reclaim it (F3). The cursor restarts at the new buffer.
    st.retired.push(st.buf);
    st.buf = new Uint8Array(Math.max(st.buf.byteLength * 2, st.used + n));
    st.used = 0;
  }
  const off = st.used;
  st.used += n;
  return off;
}

/** Encode `s` at its own scratch offset — returns the (ptr, len) FFI slot pair. */
function encodeScratch(st: MarshalScratch, helpers: PtrHelpers, s: string): { ptr: unknown; len: number } {
  const max = s.length * 4 + 4;
  const off = bumpScratch(st, max);
  const region = st.buf.subarray(off, off + max);
  const { written } = st.encoder.encodeInto(s, region);
  return { ptr: helpers.ptr(region.subarray(0, written)), len: written };
}

/** Copy `data` at its own scratch offset — returns the ptr for the FFI slot. */
function copyScratch(st: MarshalScratch, helpers: PtrHelpers, data: Uint8Array): unknown {
  const off = bumpScratch(st, data.byteLength);
  st.buf.set(data, off);
  return helpers.ptr(st.buf.subarray(off, off + data.byteLength));
}

/** Scan a NUL-terminated C string at `addr` (doubling reads; 1 MiB hard cap). */
function readNativeCString(helpers: PtrHelpers, addr: number | bigint): string {
  let size = 64;
  for (;;) {
    const bytes = helpers.readBytes(addr, size);
    const zero = bytes.indexOf(0);
    if (zero >= 0) return cstrDecoder.decode(bytes.subarray(0, zero));
    if (size >= 1 << 20) {
      throw new ScriptcableError('ABI', 'unterminated cstring return (no NUL within 1 MiB)');
    }
    size *= 16;
  }
}

/**
 * Slot positions of each param in the flat FFI argument list — string/bytes
 * take two slots (ptr, len); everything else one. Precomputed per export so
 * the hot path writes a reused array instead of building one per call.
 */
function slotLayout(def: ExportDef): { slots: number[]; totalSlots: number; outBase: number } {
  const slots: number[] = [];
  let pos = 0;
  for (const p of def.params) {
    slots.push(pos);
    pos += p === 'string' || p === 'bytes' ? 2 : 1;
  }
  const outBase = pos;
  const marshaledRet = def.returns === 'string' || def.returns === 'bytes';
  return { slots, totalSlots: pos + (marshaledRet ? 2 : 0), outBase };
}

/**
 * Marshaled exports (string/bytes in or out) get a per-export closure over
 * the binding's scratch — no per-call ffiArgs/keepAlive arrays, no per-call
 * ptr() for the stable scratch.
 */
function makeMarshaledFfiFn(
  raw: (...a: never[]) => unknown,
  def: ExportDef,
  st: MarshalScratch,
  helpers: PtrHelpers,
): (...args: unknown[]) => unknown {
  const { slots, totalSlots, outBase } = slotLayout(def);
  const args: unknown[] = new Array(totalSlots);
  const params = def.params;
  const n = params.length;
  const hasOut = def.returns === 'string' || def.returns === 'bytes';
  if (hasOut) {
    args[outBase] = st.outPtrArg;
    args[outBase + 1] = st.outLenArg;
  }
  return (...callArgs: unknown[]): unknown => {
    // Fresh bump per call — the native path has no JS callbacks (re-entrancy
    // exists only in the WASM loader), so shared scratch is safe, but every
    // parameter gets its own region inside it (F3).
    st.used = 0;
    st.retired.length = 0;
    for (let i = 0; i < n; i++) {
      const cls = params[i]!;
      const v = callArgs[i];
      const slot = slots[i]!;
      if (cls === 'string') {
        const { ptr, len } = encodeScratch(st, helpers, String(v ?? ''));
        args[slot] = ptr;
        args[slot + 1] = len;
      } else if (cls === 'bytes') {
        const data = v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer);
        args[slot] = copyScratch(st, helpers, data);
        args[slot + 1] = data.byteLength;
      } else if (cls === 'cstring') {
        args[slot] = encodeScratch(st, helpers, String(v ?? '') + '\0').ptr;
      } else if (cls === 'bool') {
        args[slot] = v ? 1 : 0;
      } else {
        args[slot] = v;
      }
    }
    if (hasOut) {
      (raw as (...a: unknown[]) => void)(...args);
      const bytes = helpers.readBytes(st.outPtr[0]!, Number(st.outLen[0]));
      return def.returns === 'string' ? st.decoder.decode(bytes) : bytes.slice();
    }
    if (def.returns === 'cstring') {
      return readNativeCString(helpers, (raw as (...a: unknown[]) => number)(...args));
    }
    return shapeFfiReturn(def, (raw as (...a: unknown[]) => unknown)(...args));
  };
}

/** True when every param/return survives bun:ffi's direct symbol call unchanged. */
function hasDirectFfiSignature(def: ExportDef): boolean {
  const marshaled =
    def.returns === 'string' || def.returns === 'bytes' || def.returns === 'cstring';
  return (
    !marshaled && def.params.every((p) => p !== 'string' && p !== 'bytes' && p !== 'cstring')
  );
}

/** Return-value shaping shared by the direct and marshaled fast paths (void, bool, BigInt i64 slots). */
function shapeFfiReturn(def: ExportDef, value: unknown): unknown {
  if (def.returns === 'void') return undefined;
  if (def.returns === 'bool') return Boolean(value);
  if (def.returns === 'i64' || def.returns === 'u64') {
    return typeof value === 'bigint' ? Number(value) : value;
  }
  return value;
}

/**
 * Per-export pre-bound direct call — no name lookup, no argument array.
 * Explicit arities keep the fast path free of rest/spread allocation.
 */
function makeDirectFfiFn(
  raw: (...a: never[]) => unknown,
  def: ExportDef,
): (...args: unknown[]) => unknown {
  const params = def.params;
  const arg = (i: number, v: unknown) => (params[i] === 'bool' ? (v ? 1 : 0) : v) as never;
  switch (params.length) {
    case 0:
      return () => shapeFfiReturn(def, (raw as () => unknown)());
    case 1:
      return (a) => shapeFfiReturn(def, raw(arg(0, a)));
    case 2:
      return (a, b) => shapeFfiReturn(def, raw(arg(0, a), arg(1, b)));
    case 3:
      return (a, b, c) => shapeFfiReturn(def, raw(arg(0, a), arg(1, b), arg(2, c)));
    case 4:
      return (a, b, c, d) => shapeFfiReturn(def, raw(arg(0, a), arg(1, b), arg(2, c), arg(3, d)));
    default:
      return (...args) => shapeFfiReturn(def, raw(...(args.map((v, i) => arg(i, v)) as never[])));
  }
}

function makeNativeModule(profile: ScriptcableProfile, binding: FfiBinding): NativeModule {
  const byName = new Map(profile.exports.map((e) => [e.export, e]));

  return {
    profile,
    call(exportName: string, ...args: unknown[]) {
      const def = byName.get(exportName);
      if (!def) {
        throw new ScriptcableError(
          'UNKNOWN_EXPORT',
          `Unknown export "${exportName}"`,
          `Known: ${[...byName.keys()].join(', ')}`,
        );
      }
      return binding.call(def.symbol, args);
    },
    fns: binding.fns,
    dispose() {
      binding.close?.();
    },
  };
}

export async function loadNativeLibrary(
  sharedPath: string,
  profile: ScriptcableProfile,
): Promise<NativeModule> {
  const binding = isBun() ? await bindBun(sharedPath, profile) : await bindKoffi(sharedPath, profile);
  return makeNativeModule(profile, binding);
}

/**
 * Synchronous variant of `loadNativeLibrary` — the underlying dlopen /
 * koffi.load are synchronous, so given a loaded module this adds no async
 * hop. The generated clients use it for the drop-in (top-level-await-free)
 * server flavor.
 */
export function loadNativeLibrarySync(
  sharedPath: string,
  profile: ScriptcableProfile,
): NativeModule {
  const req = createRequire(import.meta.url);
  const binding = isBun()
    ? bindBunSync(sharedPath, profile, req('bun:ffi') as typeof import('bun:ffi'))
    : bindKoffiSync(sharedPath, profile, req('koffi') as KoffiModule);
  return makeNativeModule(profile, binding);
}

export async function loadNativeFromOutDir(outDir: string): Promise<NativeModule> {
  const profile = JSON.parse(await readFile(`${outDir}/profile.json`, 'utf8')) as ScriptcableProfile;
  const soPath = `${outDir}/${sharedLibraryFileName(profile.name)}`;
  return loadNativeLibrary(soPath, profile);
}
