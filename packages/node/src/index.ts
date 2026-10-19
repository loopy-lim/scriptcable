/** @scriptca/node — Node.js WASI loader for scriptc library WASM. */
export {
  loadWasmFile,
  loadWasmModule,
  type LoadedModule,
  type LoadWasmOptions,
} from '@scriptca/core/wasm';
export { buildCore, doctor, configToProfile, snapshotFromConfig } from '@scriptca/core';
export type {
  EngineClient,
  ScriptcaConfig,
  ScriptcaProfile,
  InvokeOptions,
} from '@scriptca/types';
export { ScriptcaError, ScriptcaToolchainError } from '@scriptca/types';

import { loadWasmFile, type LoadedModule } from '@scriptca/core/wasm';
import type { ScriptcaProfile, EngineClient } from '@scriptca/types';
import { readFile } from 'node:fs/promises';

export type NodeClientOptions = {
  wasmPath: string;
  profile: ScriptcaProfile;
  callbacks?: Record<string, (...args: unknown[]) => unknown>;
};

/** Load a compiled core and return a simple EngineClient (JSON-ish invoke). */
export async function createNodeEngine(options: NodeClientOptions): Promise<
  EngineClient & { module: LoadedModule; call: LoadedModule['call'] }
> {
  const mod = await loadWasmFile(options.wasmPath, {
    profile: options.profile,
    callbacks: options.callbacks,
  });
  return {
    module: mod,
    call: mod.call.bind(mod),
    supports: { sync: true },
    async invoke(command: string, args?: unknown) {
      const list = Array.isArray(args) ? args : args === undefined ? [] : [args];
      return mod.call(command, ...list);
    },
    dispose() {
      mod.dispose();
    },
  };
}

/** Convenience: load profile.json + wasm from a .scriptca outDir. */
export async function createNodeEngineFromOutDir(
  outDir: string,
  callbacks?: Record<string, (...args: unknown[]) => unknown>,
): Promise<EngineClient & { module: LoadedModule; call: LoadedModule['call'] }> {
  const profile = JSON.parse(await readFile(`${outDir}/profile.json`, 'utf8')) as ScriptcaProfile;
  const wasmPath = `${outDir}/${profile.name}.wasm`;
  return createNodeEngine({ wasmPath, profile, callbacks });
}
