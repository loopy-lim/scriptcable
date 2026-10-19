/** @scriptca/node — Node.js adapter (native shared library by default; WASM opt-in). */
export {
  loadNativeLibrary,
  loadNativeFromOutDir,
  type NativeModule,
} from '@scriptca/core/native';
export {
  loadWasmFile,
  loadWasmModule,
  type LoadedModule,
  type LoadWasmOptions,
} from '@scriptca/core/wasm';
export { buildCore, doctor, configToProfile, snapshotFromConfig, linkSharedLibrary } from '@scriptca/core';
export type {
  EngineClient,
  ScriptcaConfig,
  ScriptcaProfile,
  InvokeOptions,
} from '@scriptca/types';
export { ScriptcaError, ScriptcaToolchainError } from '@scriptca/types';

import { loadNativeFromOutDir, type NativeModule } from '@scriptca/core/native';
import { loadWasmFile, type LoadedModule } from '@scriptca/core/wasm';
import type { ScriptcaProfile, EngineClient } from '@scriptca/types';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { sharedLibraryFileName } from '@scriptca/core';

export type NodeClientOptions = {
  /** Directory containing profile.json + shared lib / wasm */
  outDir: string;
  /** Force wasm even if a native shared library is present */
  preferWasm?: boolean;
  callbacks?: Record<string, (...args: unknown[]) => unknown>;
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a compiled core. Prefers the native shared library; falls back to WASM
 * only when preferWasm is set or the shared library is missing.
 */
export async function createNodeEngine(
  options: NodeClientOptions,
): Promise<
  EngineClient & {
    call: (exportName: string, ...args: unknown[]) => unknown;
    module: NativeModule | LoadedModule;
  }
> {
  const { outDir } = options;
  const profile = JSON.parse(
    await (await import('node:fs/promises')).readFile(join(outDir, 'profile.json'), 'utf8'),
  ) as ScriptcaProfile;
  const soPath = join(outDir, sharedLibraryFileName(profile.name));
  const wasmPath = join(outDir, `${profile.name}.wasm`);

  if (!options.preferWasm && (await exists(soPath))) {
    const mod = await loadNativeFromOutDir(outDir);
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

  if (!(await exists(wasmPath))) {
    throw new (await import('@scriptca/types')).ScriptcaError(
      'MISSING_ARTIFACT',
      `No native shared library (${soPath}) or WASM (${wasmPath}) found.`,
      'Run: scriptca build   (native default)  or  scriptca build --target wasm',
    );
  }

  const mod = await loadWasmFile(wasmPath, { profile, callbacks: options.callbacks });
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

/** @deprecated use createNodeEngine({ outDir }) — kept for compatibility */
export async function createNodeEngineFromOutDir(
  outDir: string,
  callbacks?: Record<string, (...args: unknown[]) => unknown>,
): Promise<
  EngineClient & {
    call: (exportName: string, ...args: unknown[]) => unknown;
    module: NativeModule | LoadedModule;
  }
> {
  return createNodeEngine({ outDir, callbacks });
}
