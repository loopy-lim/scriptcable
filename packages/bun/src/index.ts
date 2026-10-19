/** @scriptca/bun — Bun host for scriptc WASM (reuses Node WASI loader; Bun supports node:wasi). */
export {
  createNodeEngine as createBunEngine,
  createNodeEngineFromOutDir as createBunEngineFromOutDir,
} from '@scriptca/node';
export type { NodeClientOptions as BunClientOptions } from '@scriptca/node';
export {
  loadWasmFile,
  loadWasmModule,
  type LoadedModule,
} from '@scriptca/core/wasm';
export { ScriptcaError } from '@scriptca/types';
