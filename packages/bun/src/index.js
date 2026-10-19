/** @scriptca/bun — Bun host for scriptc WASM (reuses Node WASI loader; Bun supports node:wasi). */
export { createNodeEngine as createBunEngine, createNodeEngineFromOutDir as createBunEngineFromOutDir, } from '@scriptca/node';
export { loadWasmFile, loadWasmModule, } from '@scriptca/core/wasm';
export { ScriptcaError } from '@scriptca/types';
//# sourceMappingURL=index.js.map