/**
 * Shared WASI Preview 1 reactor loader for scriptc library WASM modules.
 * Works in Node 24+ (node:wasi) and can be adapted for Bun / browsers.
 */
import type { ScriptcaProfile } from '@scriptca/types';
export type WasmExports = WebAssembly.Exports & {
    memory: WebAssembly.Memory;
    scriptc_alloc: (size: number) => number;
    scriptc_free: (ptr: number) => void;
    [key: string]: unknown;
};
export type LoadedModule = {
    exports: WasmExports;
    profile: ScriptcaProfile;
    /** Call a typed export by TypeScript name */
    call: (exportName: string, ...args: unknown[]) => unknown;
    dispose: () => void;
};
export type LoadWasmOptions = {
    profile: ScriptcaProfile;
    /** Host callback implementations keyed by callback name */
    callbacks?: Record<string, (...args: unknown[]) => unknown>;
    /**
     * Provide WASI import object + initialize.
     * Node: use node:wasi WASI preview1.
     */
    wasi: {
        getImportObject(): WebAssembly.Imports;
        initialize(instance: WebAssembly.Instance): void;
    };
    /** Optional panic handler */
    onPanic?: (message: string) => void;
};
/** Instantiate a scriptc library WASM buffer. */
export declare function loadWasmModule(wasmBytes: BufferSource, options: LoadWasmOptions): Promise<LoadedModule>;
/** Node helper: load from a filesystem path. */
export declare function loadWasmFile(path: string, options: Omit<LoadWasmOptions, 'wasi'> & {
    wasi?: LoadWasmOptions['wasi'];
}): Promise<LoadedModule>;
//# sourceMappingURL=wasm-loader.d.ts.map