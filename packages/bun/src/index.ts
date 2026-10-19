/** @scriptca/bun — Bun host (native via bun:ffi by default; WASM opt-in). */
export {
  createNodeEngine as createBunEngine,
  createNodeEngineFromOutDir as createBunEngineFromOutDir,
  type NodeClientOptions as BunClientOptions,
} from '@scriptca/node';
export {
  loadNativeLibrary,
  loadNativeFromOutDir,
  type NativeModule,
} from '@scriptca/core/native';
export {
  loadWasmFile,
  loadWasmModule,
  type LoadedModule,
} from '@scriptca/core/wasm';
export { ScriptcaError } from '@scriptca/types';
