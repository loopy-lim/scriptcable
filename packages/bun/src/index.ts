/** @scriptcable/bun — Bun host (native via bun:ffi by default; WASM opt-in). */
export {
  createNodeEngine as createBunEngine,
  createNodeEngineFromOutDir as createBunEngineFromOutDir,
  type NodeClientOptions as BunClientOptions,
} from '@scriptcable/node';
export {
  loadNativeLibrary,
  loadNativeFromOutDir,
  type NativeModule,
} from '@scriptcable/core/native';
export {
  loadWasmFile,
  loadWasmModule,
  type LoadedModule,
} from '@scriptcable/core/wasm';
export { ScriptcableError } from '@scriptcable/types';
