/**
 * Shared WASI Preview 1 reactor loader for scriptc library WASM modules.
 * Works in Node 24+ (node:wasi) and can be adapted for Bun / browsers.
 */
import type { AbiClass, CallbackDef, ExportDef, ScriptcableProfile } from '@scriptcable/types';
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
  dispose: () => void;
};

export type LoadWasmOptions = {
  profile: ScriptcableProfile;
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

function writeBytes(api: WasmExports, data: Uint8Array): { ptr: number; len: number } {
  const ptr = api.scriptc_alloc(data.byteLength || 1);
  if (!ptr && data.byteLength > 0) {
    throw new ScriptcableError('ALLOC', 'scriptc_alloc failed');
  }
  if (data.byteLength > 0) {
    new Uint8Array(api.memory.buffer, ptr, data.byteLength).set(data);
  }
  return { ptr, len: data.byteLength };
}

function writeString(api: WasmExports, text: string): { ptr: number; len: number } {
  return writeBytes(api, new TextEncoder().encode(text));
}

function readResultString(
  api: WasmExports,
  outPtrSlot: number,
  outLenSlot: number,
): string {
  const view = new DataView(api.memory.buffer);
  const ptr = view.getInt32(outPtrSlot, true);
  const len = view.getInt32(outLenSlot, true);
  const bytes = new Uint8Array(api.memory.buffer, ptr, len);
  return new TextDecoder().decode(bytes);
}

function readResultBytes(
  api: WasmExports,
  outPtrSlot: number,
  outLenSlot: number,
): Uint8Array {
  const view = new DataView(api.memory.buffer);
  const ptr = view.getInt32(outPtrSlot, true);
  const len = view.getInt32(outLenSlot, true);
  return new Uint8Array(api.memory.buffer, ptr, len).slice();
}

function marshalArgs(
  api: WasmExports,
  params: AbiClass[],
  args: unknown[],
): { wasmArgs: number[]; freeList: number[] } {
  const wasmArgs: number[] = [];
  const freeList: number[] = [];
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
        const { ptr, len } = writeString(api, String(v ?? ''));
        freeList.push(ptr);
        wasmArgs.push(ptr, len);
        break;
      }
      case 'bytes': {
        const data = v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer);
        const { ptr, len } = writeBytes(api, data);
        freeList.push(ptr);
        wasmArgs.push(ptr, len);
        break;
      }
      case 'cstring': {
        const enc = new TextEncoder().encode(String(v ?? '') + '\0');
        const { ptr } = writeBytes(api, enc);
        freeList.push(ptr);
        wasmArgs.push(ptr);
        break;
      }
      default:
        throw new ScriptcableError('ABI', `Unsupported param class: ${cls}`);
    }
  }
  return { wasmArgs, freeList };
}

function callExport(
  api: WasmExports,
  def: ExportDef,
  args: unknown[],
): unknown {
  const fn = api[def.symbol];
  if (typeof fn !== 'function') {
    throw new ScriptcableError('MISSING_EXPORT', `Export symbol ${def.symbol} not found in WASM`);
  }

  const { wasmArgs, freeList } = marshalArgs(api, def.params, args);
  try {
    if (def.returns === 'string' || def.returns === 'bytes') {
      // Two i32 out-slots for pointer + length
      const slots = api.scriptc_alloc(8);
      if (!slots) throw new ScriptcableError('ALLOC', 'failed to allocate result slots');
      freeList.push(slots);
      const outPtr = slots;
      const outLen = slots + 4;
      (fn as (...a: number[]) => void)(...wasmArgs, outPtr, outLen);
      return def.returns === 'string'
        ? readResultString(api, outPtr, outLen)
        : readResultBytes(api, outPtr, outLen);
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
    for (const ptr of freeList) {
      try {
        api.scriptc_free(ptr);
      } catch {
        /* ignore */
      }
    }
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
  const module = await WebAssembly.compile(wasmBytes);
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
      return callExport(api, def, args);
    },
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
  const { readFile } = await import('node:fs/promises');
  const { WASI } = await import('node:wasi');
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
