/** @scriptca/node — Node.js WASI loader for scriptc library WASM. */
export { loadWasmFile, loadWasmModule, } from '@scriptca/core/wasm';
export { buildCore, doctor, configToProfile, snapshotFromConfig } from '@scriptca/core';
export { ScriptcaError, ScriptcaToolchainError } from '@scriptca/types';
import { loadWasmFile } from '@scriptca/core/wasm';
import { readFile } from 'node:fs/promises';
/** Load a compiled core and return a simple EngineClient (JSON-ish invoke). */
export async function createNodeEngine(options) {
    const mod = await loadWasmFile(options.wasmPath, {
        profile: options.profile,
        callbacks: options.callbacks,
    });
    return {
        module: mod,
        call: mod.call.bind(mod),
        supports: { sync: true },
        async invoke(command, args) {
            const list = Array.isArray(args) ? args : args === undefined ? [] : [args];
            return mod.call(command, ...list);
        },
        dispose() {
            mod.dispose();
        },
    };
}
/** Convenience: load profile.json + wasm from a .scriptca outDir. */
export async function createNodeEngineFromOutDir(outDir, callbacks) {
    const profile = JSON.parse(await readFile(`${outDir}/profile.json`, 'utf8'));
    const wasmPath = `${outDir}/${profile.name}.wasm`;
    return createNodeEngine({ wasmPath, profile, callbacks });
}
//# sourceMappingURL=index.js.map