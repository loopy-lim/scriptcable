/**
 * Shared WASI Preview 1 reactor loader for scriptc library WASM modules.
 * Works in Node 24+ (node:wasi) and can be adapted for Bun / browsers.
 */
import type { AbiClass, BatchEntry, CallbackDef, ExportDef, ScriptcableProfile } from '@scriptcable/types';
import { ScriptcableError } from '@scriptcable/types';

export type WasmExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  scriptc_alloc: (size: number) => number;
  scriptc_free: (ptr: number) => void;
  [key: string]: unknown;
};

export type LoadedModule = {
  exports: WasmExports;
  profile: ScriptcableProfile;
  /** Call a typed export by TypeScript name */
  call: (exportName: string, ...args: unknown[]) => unknown;
  /**
   * Per-export pre-bound functions keyed by TypeScript export name — skips
   * the dispatch of `call`. f64/f32-only signatures bind the wasm export
   * directly; the rest reuse the same marshaling as `call`.
   */
  fns: Record<string, (...args: unknown[]) => unknown>;
  /**
   * Sequential batch — N calls through the regular marshaling. An
   * in-boundary batch (one crossing for N calls) needs a batch executive
   * inside the wasm module, which is scriptc-runtime territory; the
   * generated N-API addon ships one, this loader does not.
   */
  batch: (entries: ReadonlyArray<BatchEntry>) => unknown[];
  dispose: () => void;
};

export type LoadWasmOptions = {
  profile: ScriptcableProfile;
  /** Pre-compiled module — skips `WebAssembly.compile(wasmBytes)` (use with compileStreaming) */
  module?: WebAssembly.Module;
  /** Host callback implementations keyed by callback name */
  callbacks?: Record<string, (...args: unknown[]) => unknown>;
  /**
   * Provide WASI import object + initialize.
   * Node: use node:wasi WASI preview1.
   */
  wasi: {
    /** Node.js style */
    getImportObject?: () => WebAssembly.Imports;
    /** Bun style — may require the compiled module */
    getImports?: (module?: WebAssembly.Module) => WebAssembly.Imports;
    initialize?: (instance: WebAssembly.Instance) => void;
    /** Bun: bind memory before calling _initialize */
    setMemory?: (memory: WebAssembly.Memory) => void;
  };
  /** Optional panic handler */
  onPanic?: (message: string) => void;
};

function readCString(memory: WebAssembly.Memory, ptr: number): string {
  const bytes = new Uint8Array(memory.buffer, ptr);
  let end = 0;
  while (bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

/**
 * Per-instance marshaling state. At depth 0 (top-level call — no JS callback
 * re-entrancy) one persistent scratch region is bump-allocated per call, and
 * the out slots / arg arrays are shared; while inside a call (depth > 0) a
 * re-entrant call — a host callback invoking another export — falls back to
 * per-call scriptc_alloc/free so it cannot corrupt the outer call's state.
 */
type WasmState = {
  api: WasmExports;
  encoder: TextEncoder;
  decoder: TextDecoder;
  depth: number;
  // Bump allocator over one persistent wasm region (depth-0 inputs only).
  scratchPtr: number;
  scratchCap: number;
  scratchUsed: number;
  slotsPtr: number; // 8 bytes: (ptr, len) out slots for marshaled returns
  // Memory views — rebuilt lazily when the buffer identity changes (grow/realloc)
  viewBuf: ArrayBufferLike | null;
  u8: Uint8Array | null;
  dv: DataView | null;
  wasmArgs: number[];
  freeList: number[];
  /** Old scratch regions replaced mid-call — freed only when the call ends (F2). */
  retired: number[];
};

function makeWasmState(): WasmState {
  return {
    api: null as unknown as WasmExports,
    encoder: new TextEncoder(),
    decoder: new TextDecoder(),
    depth: 0,
    scratchPtr: 0,
    scratchCap: 0,
    scratchUsed: 0,
    slotsPtr: 0,
    viewBuf: null,
    u8: null,
    dv: null,
    wasmArgs: [],
    freeList: [],
    retired: [],
  };
}

function views(st: WasmState): { u8: Uint8Array; dv: DataView } {
  const buf = st.api.memory.buffer;
  if (st.viewBuf !== buf || !st.u8 || !st.dv) {
    st.viewBuf = buf;
    st.u8 = new Uint8Array(buf);
    st.dv = new DataView(buf);
  }
  return { u8: st.u8, dv: st.dv };
}

function growScratch(st: WasmState, need: number): void {
  const cap = Math.max(st.scratchCap * 2, need, 1024);
  // Mid-call growth must NOT free the old region — earlier parameters of the
  // SAME call still point into it and wasm reads them after this bump (F2).
  // Retire it: scriptc_free runs when the call ends, in callExport's finally.
  if (st.scratchPtr) st.retired.push(st.scratchPtr);
  const ptr = st.api.scriptc_alloc(cap);
  if (!ptr) throw new ScriptcableError('ALLOC', 'scriptc_alloc failed');
  st.scratchPtr = ptr;
  st.scratchCap = cap;
  st.scratchUsed = 0;
  st.viewBuf = null;
  st.u8 = null;
  st.dv = null;
}

/** Bump-allocate `size` bytes — shared region at depth 0, per-call alloc/free while re-entrant. */
function bumpScratch(st: WasmState, size: number, freeList: number[] | null): number {
  const n = size || 1;
  if (freeList === null) {
    st.scratchUsed = (st.scratchUsed + 15) & ~15;
    if (st.scratchUsed + n > st.scratchCap) growScratch(st, st.scratchUsed + n);
    const ptr = st.scratchPtr + st.scratchUsed;
    st.scratchUsed += n;
    return ptr;
  }
  const ptr = st.api.scriptc_alloc(n);
  if (!ptr) throw new ScriptcableError('ALLOC', 'scriptc_alloc failed');
  freeList.push(ptr);
  return ptr;
}

function writeBytes(st: WasmState, data: Uint8Array, freeList: number[] | null): { ptr: number; len: number } {
  const ptr = bumpScratch(st, data.byteLength, freeList);
  if (data.byteLength > 0) views(st).u8.set(data, ptr);
  return { ptr, len: data.byteLength };
}

function writeString(st: WasmState, text: string, freeList: number[] | null): { ptr: number; len: number } {
  // Worst-case utf8 reservation, encoded straight into wasm memory — no JS
  // intermediate buffer and no per-call TextEncoder. The bump cursor resets
  // per call, so over-reserving only sizes the persistent region once.
  const max = text.length * 4 + 4;
  const ptr = bumpScratch(st, max, freeList);
  const { written } = st.encoder.encodeInto(text, views(st).u8.subarray(ptr, ptr + max));
  return { ptr, len: written };
}

function readResultString(st: WasmState, outPtrSlot: number, outLenSlot: number): string {
  const { u8, dv } = views(st);
  const ptr = dv.getInt32(outPtrSlot, true);
  const len = dv.getInt32(outLenSlot, true);
  return st.decoder.decode(u8.subarray(ptr, ptr + len));
}

function readResultBytes(st: WasmState, outPtrSlot: number, outLenSlot: number): Uint8Array {
  const { u8, dv } = views(st);
  const ptr = dv.getInt32(outPtrSlot, true);
  const len = dv.getInt32(outLenSlot, true);
  return u8.slice(ptr, ptr + len);
}

function marshalArgs(
  st: WasmState,
  params: AbiClass[],
  args: unknown[],
  wasmArgs: number[],
  freeList: number[] | null, // null → shared (depth-0) scratch; array → per-call alloc/free
): void {
  for (let i = 0; i < params.length; i++) {
    const cls = params[i]!;
    const v = args[i];
    switch (cls) {
      case 'f64':
      case 'f32':
        wasmArgs.push(Number(v));
        break;
      case 'bool':
        wasmArgs.push(v ? 1 : 0);
        break;
      case 'u8':
      case 'u16':
      case 'u32':
      case 'i8':
      case 'i16':
      case 'i32':
        wasmArgs.push(Number(v) | 0);
        break;
      case 'i64':
      case 'u64':
        // BigInt path — WebAssembly.Instance accepts bigint for i64
        wasmArgs.push(v as unknown as number);
        break;
      case 'string': {
        const { ptr, len } = writeString(st, String(v ?? ''), freeList);
        wasmArgs.push(ptr, len);
        break;
      }
      case 'bytes': {
        const data = v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer);
        const { ptr, len } = writeBytes(st, data, freeList);
        wasmArgs.push(ptr, len);
        break;
      }
      case 'cstring': {
        const text = String(v ?? '') + '\0';
        const max = text.length * 4 + 4;
        const ptr = bumpScratch(st, max, freeList);
        st.encoder.encodeInto(text, views(st).u8.subarray(ptr, ptr + max));
        wasmArgs.push(ptr);
        break;
      }
      default:
        throw new ScriptcableError('ABI', `Unsupported param class: ${cls}`);
    }
  }
}

function callExport(
  st: WasmState,
  def: ExportDef,
  args: unknown[],
): unknown {
  const api = st.api;
  const fn = api[def.symbol];
  if (typeof fn !== 'function') {
    throw new ScriptcableError('MISSING_EXPORT', `Export symbol ${def.symbol} not found in WASM`);
  }

  // Shared (depth-0) state resets once per top-level call; a re-entrant call
  // (JS callback → another export) gets its own args array and per-call
  // allocations so it cannot touch the outer call's marshaled arguments.
  const shared = st.depth === 0;
  if (shared) {
    st.scratchUsed = 0;
    st.wasmArgs.length = 0;
    st.freeList.length = 0;
    st.retired.length = 0;
  }
  st.depth++;
  // st.wasmArgs is reused across shared calls — the spread into the wasm
  // export consumes it before any JS callback (and any re-entrant marshal,
  // which uses its own array below) can run.
  const wasmArgs = shared ? st.wasmArgs : [];
  const freeList = shared ? st.freeList : [];
  try {
    marshalArgs(st, def.params, args, wasmArgs, shared ? null : freeList);
    if (def.returns === 'string' || def.returns === 'bytes') {
      // Two i32 out-slots for pointer + length — persistent at depth 0.
      let slots = st.slotsPtr;
      if (shared) {
        if (!slots) {
          slots = api.scriptc_alloc(8);
          if (!slots) throw new ScriptcableError('ALLOC', 'failed to allocate result slots');
          st.slotsPtr = slots;
        }
      } else {
        slots = api.scriptc_alloc(8);
        if (!slots) throw new ScriptcableError('ALLOC', 'failed to allocate result slots');
        freeList.push(slots);
      }
      const outPtr = slots;
      const outLen = slots + 4;
      (fn as (...a: number[]) => void)(...wasmArgs, outPtr, outLen);
      return def.returns === 'string'
        ? readResultString(st, outPtr, outLen)
        : readResultBytes(st, outPtr, outLen);
    }
    if (def.returns === 'cstring') {
      const ptr = (fn as (...a: number[]) => number)(...wasmArgs);
      return readCString(api.memory, ptr);
    }
    if (def.returns === 'void') {
      (fn as (...a: number[]) => void)(...wasmArgs);
      return undefined;
    }
    if (def.returns === 'bool') {
      return Boolean((fn as (...a: number[]) => number)(...wasmArgs));
    }
    return (fn as (...a: number[]) => unknown)(...wasmArgs);
  } finally {
    st.depth--;
    for (const ptr of freeList) {
      try {
        api.scriptc_free(ptr);
      } catch {
        /* ignore */
      }
    }
    // Scratch regions retired mid-call are still referenced by this call's
    // marshaled arguments — free them only now (F2). Growth happens only on
    // the shared (depth-0) frame, so only ITS finally may free retired
    // regions: an inner frame freeing them would poison parameters the outer
    // call re-reads after the callback returns (F6).
    if (shared) {
      for (const ptr of st.retired) {
        try {
          api.scriptc_free(ptr);
        } catch {
          /* ignore */
        }
      }
      st.retired.length = 0;
    }
  }
}

/** f64/f32-only signatures pass straight through the wasm boundary. */
function hasDirectWasmSignature(def: ExportDef): boolean {
  return (
    def.params.every((p) => p === 'f64' || p === 'f32') &&
    def.returns !== 'string' &&
    def.returns !== 'bytes' &&
    def.returns !== 'cstring'
  );
}

/** Pre-bound direct wasm export — Number() coercion only, no dispatch. */
function makeDirectWasmFn(
  raw: (...a: number[]) => unknown,
  def: ExportDef,
): (...args: unknown[]) => unknown {
  // callExport shapes bool returns to real booleans — the direct path must
  // keep that parity (0/1 from wasm would leak through the `as boolean` cast).
  const shape = (v: unknown): unknown => (def.returns === 'bool' ? Boolean(v) : v);
  switch (def.params.length) {
    case 0:
      return () => shape(raw());
    case 1:
      return (a) => shape(raw(Number(a)));
    case 2:
      return (a, b) => shape(raw(Number(a), Number(b)));
    case 3:
      return (a, b, c) => shape(raw(Number(a), Number(b), Number(c)));
    case 4:
      return (a, b, c, d) => shape(raw(Number(a), Number(b), Number(c), Number(d)));
    default:
      return (...args) => shape(raw(...args.map((v) => Number(v))));
  }
}

function buildScriptcImports(
  profile: ScriptcableProfile,
  getApi: () => WasmExports,
  callbacks: Record<string, (...args: unknown[]) => unknown>,
  onPanic?: (message: string) => void,
): WebAssembly.ModuleImports {
  const imports: Record<string, (...args: number[]) => unknown> = {
    panic(pointer: number, length: number) {
      const api = getApi();
      const bytes = new Uint8Array(api.memory.buffer, pointer, length);
      const msg = new TextDecoder().decode(bytes);
      if (onPanic) onPanic(msg);
      throw new ScriptcableError('PANIC', msg);
    },
  };

  for (const cb of profile.callbacks ?? []) {
    imports[cb.name] = (...raw: number[]) => {
      const api = getApi();
      const host = callbacks[cb.name];
      if (!host) {
        throw new ScriptcableError(
          'MISSING_CALLBACK',
          `Host callback "${cb.name}" was not provided`,
          `Pass callbacks: { ${cb.name}: (...) => ... } when loading the module.`,
        );
      }
      const decoded = demarshalCallbackArgs(api, cb, raw);
      return host(...decoded);
    };
  }

  return imports;
}

function demarshalCallbackArgs(
  api: WasmExports,
  cb: CallbackDef,
  raw: number[],
): unknown[] {
  const out: unknown[] = [];
  let i = 0;
  for (const cls of cb.params) {
    switch (cls) {
      case 'f64':
      case 'f32':
        out.push(raw[i++]);
        break;
      case 'bool':
        out.push(Boolean(raw[i++]));
        break;
      case 'u8':
      case 'u16':
      case 'u32':
      case 'i8':
      case 'i16':
      case 'i32':
        out.push(raw[i++]);
        break;
      case 'string':
      case 'bytes': {
        const ptr = raw[i++]!;
        const len = raw[i++]!;
        const bytes = new Uint8Array(api.memory.buffer, ptr, len);
        out.push(cls === 'string' ? new TextDecoder().decode(bytes) : bytes.slice());
        break;
      }
      case 'cstring': {
        out.push(readCString(api.memory, raw[i++]!));
        break;
      }
      default:
        out.push(raw[i++]);
    }
  }
  return out;
}

/** Instantiate a scriptc library WASM buffer. */
export async function loadWasmModule(
  wasmBytes: BufferSource,
  options: LoadWasmOptions,
): Promise<LoadedModule> {
  const { profile, wasi, callbacks = {}, onPanic } = options;
  let api!: WasmExports;

  const scriptcImports = buildScriptcImports(profile, () => api, callbacks, onPanic);
  // A pre-compiled module (e.g. via compileStreaming) skips the bytes→compile step
  const module = options.module ?? (await WebAssembly.compile(wasmBytes));
  const wasiImports =
    typeof wasi.getImportObject === 'function'
      ? wasi.getImportObject()
      : typeof wasi.getImports === 'function'
        ? wasi.getImports(module)
        : {};
  const instance = await WebAssembly.instantiate(module, {
    ...wasiImports,
    scriptc: scriptcImports,
  });
  api = instance.exports as WasmExports;

  // Reactor init: Node wasi.initialize, or Bun setMemory + _initialize.
  if (typeof wasi.setMemory === 'function' && api.memory) {
    wasi.setMemory(api.memory);
  }
  if (typeof wasi.initialize === 'function') {
    wasi.initialize(instance);
  } else if (typeof api._initialize === 'function') {
    (api._initialize as () => void)();
  }

  const init = api[profile.abi.init_symbol];
  if (typeof init === 'function') {
    (init as () => void)();
  }

  const byName = new Map(profile.exports.map((e) => [e.export, e]));
  const st = makeWasmState();
  st.api = api;

  const fns: Record<string, (...args: unknown[]) => unknown> = {};
  for (const e of profile.exports) {
    const raw = api[e.symbol];
    if (typeof raw !== 'function') {
      fns[e.export] = () => {
        throw new ScriptcableError('MISSING_EXPORT', `Export symbol ${e.symbol} not found in WASM`);
      };
    } else if (hasDirectWasmSignature(e)) {
      fns[e.export] = makeDirectWasmFn(raw as (...a: number[]) => unknown, e);
    } else {
      fns[e.export] = (...args: unknown[]) => callExport(st, e, args);
    }
  }

  return {
    exports: api,
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
      return callExport(st, def, args);
    },
    batch(entries: ReadonlyArray<BatchEntry>) {
      return entries.map((e) => {
        const def = byName.get(e[0]);
        if (!def) {
          throw new ScriptcableError(
            'UNKNOWN_EXPORT',
            `Unknown export "${e[0]}"`,
            `Known: ${[...byName.keys()].join(', ')}`,
          );
        }
        return callExport(st, def, e.slice(1) as unknown[]);
      });
    },
    fns,
    dispose() {
      // Wasm memory is GC'd with the instance; nothing to free explicitly.
    },
  };
}

/** Node helper: load from a filesystem path. */
export async function loadWasmFile(
  path: string,
  options: Omit<LoadWasmOptions, 'wasi'> & {
    wasi?: LoadWasmOptions['wasi'];
  },
): Promise<LoadedModule> {
  // webpackIgnore / turbopackIgnore: these node: builtins sit behind a
  // runtime guard (Node-only path) — bundlers compiling this file for the
  // browser must not resolve them at build time (UnhandledSchemeError).
  const { readFile } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ 'node:fs/promises');
  const { WASI } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ 'node:wasi');
  const bytes = await readFile(path);
  let wasi = options.wasi;
  if (!wasi) {
    const nodeWasi = new WASI({
      version: 'preview1',
      returnOnExit: true,
    }) as unknown as {
      getImportObject?: () => WebAssembly.Imports;
      getImports?: (module?: WebAssembly.Module) => WebAssembly.Imports;
      initialize?: (instance: WebAssembly.Instance) => void;
    };
    wasi = {
      getImportObject: nodeWasi.getImportObject?.bind(nodeWasi),
      getImports: nodeWasi.getImports?.bind(nodeWasi),
      initialize: nodeWasi.initialize?.bind(nodeWasi),
      setMemory: (nodeWasi as { setMemory?: (m: WebAssembly.Memory) => void }).setMemory?.bind(nodeWasi),
    };
  }
  return loadWasmModule(bytes, { ...options, wasi });
}
