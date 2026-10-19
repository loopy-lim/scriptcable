/** @scriptca/node — Node.js WASI loader for scriptc library WASM. */
export { loadWasmFile, loadWasmModule, type LoadedModule, type LoadWasmOptions, } from '@scriptca/core/wasm';
export { buildCore, doctor, configToProfile, snapshotFromConfig } from '@scriptca/core';
export type { EngineClient, ScriptcaConfig, ScriptcaProfile, InvokeOptions, } from '@scriptca/types';
export { ScriptcaError, ScriptcaToolchainError } from '@scriptca/types';
import { type LoadedModule } from '@scriptca/core/wasm';
import type { ScriptcaProfile, EngineClient } from '@scriptca/types';
export type NodeClientOptions = {
    wasmPath: string;
    profile: ScriptcaProfile;
    callbacks?: Record<string, (...args: unknown[]) => unknown>;
};
/** Load a compiled core and return a simple EngineClient (JSON-ish invoke). */
export declare function createNodeEngine(options: NodeClientOptions): Promise<EngineClient & {
    module: LoadedModule;
    call: LoadedModule['call'];
}>;
/** Convenience: load profile.json + wasm from a .scriptca outDir. */
export declare function createNodeEngineFromOutDir(outDir: string, callbacks?: Record<string, (...args: unknown[]) => unknown>): Promise<EngineClient & {
    module: LoadedModule;
    call: LoadedModule['call'];
}>;
//# sourceMappingURL=index.d.ts.map