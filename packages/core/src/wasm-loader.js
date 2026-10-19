import { ScriptcaError } from '@scriptca/types';
function readCString(memory, ptr) {
    const bytes = new Uint8Array(memory.buffer, ptr);
    let end = 0;
    while (bytes[end] !== 0)
        end++;
    return new TextDecoder().decode(bytes.subarray(0, end));
}
function writeBytes(api, data) {
    const ptr = api.scriptc_alloc(data.byteLength || 1);
    if (!ptr && data.byteLength > 0) {
        throw new ScriptcaError('ALLOC', 'scriptc_alloc failed');
    }
    if (data.byteLength > 0) {
        new Uint8Array(api.memory.buffer, ptr, data.byteLength).set(data);
    }
    return { ptr, len: data.byteLength };
}
function writeString(api, text) {
    return writeBytes(api, new TextEncoder().encode(text));
}
function readResultString(api, outPtrSlot, outLenSlot) {
    const view = new DataView(api.memory.buffer);
    const ptr = view.getInt32(outPtrSlot, true);
    const len = view.getInt32(outLenSlot, true);
    const bytes = new Uint8Array(api.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
}
function readResultBytes(api, outPtrSlot, outLenSlot) {
    const view = new DataView(api.memory.buffer);
    const ptr = view.getInt32(outPtrSlot, true);
    const len = view.getInt32(outLenSlot, true);
    return new Uint8Array(api.memory.buffer, ptr, len).slice();
}
function marshalArgs(api, params, args) {
    const wasmArgs = [];
    const freeList = [];
    for (let i = 0; i < params.length; i++) {
        const cls = params[i];
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
                wasmArgs.push(v);
                break;
            case 'string': {
                const { ptr, len } = writeString(api, String(v ?? ''));
                freeList.push(ptr);
                wasmArgs.push(ptr, len);
                break;
            }
            case 'bytes': {
                const data = v instanceof Uint8Array ? v : new Uint8Array(v);
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
                throw new ScriptcaError('ABI', `Unsupported param class: ${cls}`);
        }
    }
    return { wasmArgs, freeList };
}
function callExport(api, def, args) {
    const fn = api[def.symbol];
    if (typeof fn !== 'function') {
        throw new ScriptcaError('MISSING_EXPORT', `Export symbol ${def.symbol} not found in WASM`);
    }
    const { wasmArgs, freeList } = marshalArgs(api, def.params, args);
    try {
        if (def.returns === 'string' || def.returns === 'bytes') {
            // Two i32 out-slots for pointer + length
            const slots = api.scriptc_alloc(8);
            if (!slots)
                throw new ScriptcaError('ALLOC', 'failed to allocate result slots');
            freeList.push(slots);
            const outPtr = slots;
            const outLen = slots + 4;
            fn(...wasmArgs, outPtr, outLen);
            return def.returns === 'string'
                ? readResultString(api, outPtr, outLen)
                : readResultBytes(api, outPtr, outLen);
        }
        if (def.returns === 'cstring') {
            const ptr = fn(...wasmArgs);
            return readCString(api.memory, ptr);
        }
        if (def.returns === 'void') {
            fn(...wasmArgs);
            return undefined;
        }
        if (def.returns === 'bool') {
            return Boolean(fn(...wasmArgs));
        }
        return fn(...wasmArgs);
    }
    finally {
        for (const ptr of freeList) {
            try {
                api.scriptc_free(ptr);
            }
            catch {
                /* ignore */
            }
        }
    }
}
function buildScriptcImports(profile, getApi, callbacks, onPanic) {
    const imports = {
        panic(pointer, length) {
            const api = getApi();
            const bytes = new Uint8Array(api.memory.buffer, pointer, length);
            const msg = new TextDecoder().decode(bytes);
            if (onPanic)
                onPanic(msg);
            throw new ScriptcaError('PANIC', msg);
        },
    };
    for (const cb of profile.callbacks ?? []) {
        imports[cb.name] = (...raw) => {
            const api = getApi();
            const host = callbacks[cb.name];
            if (!host) {
                throw new ScriptcaError('MISSING_CALLBACK', `Host callback "${cb.name}" was not provided`, `Pass callbacks: { ${cb.name}: (...) => ... } when loading the module.`);
            }
            const decoded = demarshalCallbackArgs(api, cb, raw);
            return host(...decoded);
        };
    }
    return imports;
}
function demarshalCallbackArgs(api, cb, raw) {
    const out = [];
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
                const ptr = raw[i++];
                const len = raw[i++];
                const bytes = new Uint8Array(api.memory.buffer, ptr, len);
                out.push(cls === 'string' ? new TextDecoder().decode(bytes) : bytes.slice());
                break;
            }
            case 'cstring': {
                out.push(readCString(api.memory, raw[i++]));
                break;
            }
            default:
                out.push(raw[i++]);
        }
    }
    return out;
}
/** Instantiate a scriptc library WASM buffer. */
export async function loadWasmModule(wasmBytes, options) {
    const { profile, wasi, callbacks = {}, onPanic } = options;
    let api;
    const scriptcImports = buildScriptcImports(profile, () => api, callbacks, onPanic);
    const module = await WebAssembly.compile(wasmBytes);
    const instance = await WebAssembly.instantiate(module, {
        ...wasi.getImportObject(),
        scriptc: scriptcImports,
    });
    api = instance.exports;
    wasi.initialize(instance);
    const init = api[profile.abi.init_symbol];
    if (typeof init === 'function') {
        init();
    }
    const byName = new Map(profile.exports.map((e) => [e.export, e]));
    return {
        exports: api,
        profile,
        call(exportName, ...args) {
            const def = byName.get(exportName);
            if (!def) {
                throw new ScriptcaError('UNKNOWN_EXPORT', `Unknown export "${exportName}"`, `Known: ${[...byName.keys()].join(', ')}`);
            }
            return callExport(api, def, args);
        },
        dispose() {
            // Wasm memory is GC'd with the instance; nothing to free explicitly.
        },
    };
}
/** Node helper: load from a filesystem path. */
export async function loadWasmFile(path, options) {
    const { readFile } = await import('node:fs/promises');
    const { WASI } = await import('node:wasi');
    const bytes = await readFile(path);
    const wasi = options.wasi ??
        new WASI({
            version: 'preview1',
            returnOnExit: true,
        });
    return loadWasmModule(bytes, { ...options, wasi });
}
//# sourceMappingURL=wasm-loader.js.map