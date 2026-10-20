/** @scriptcable/node — Node.js adapter (native shared library by default; WASM opt-in). */
export {
  loadNativeLibrary,
  loadNativeFromOutDir,
  type NativeModule,
} from '@scriptcable/core/native';
export {
  loadWasmFile,
  loadWasmModule,
  type LoadedModule,
  type LoadWasmOptions,
} from '@scriptcable/core/wasm';
export { buildCore, doctor, configToProfile, snapshotFromConfig, linkSharedLibrary } from '@scriptcable/core';
export type {
  EngineClient,
  ScriptcableConfig,
  ScriptcableProfile,
  InvokeOptions,
} from '@scriptcable/types';
export { ScriptcableError, ScriptcableToolchainError } from '@scriptcable/types';

import { loadNativeFromOutDir, type NativeModule } from '@scriptcable/core/native';
import { loadWasmFile, type LoadedModule } from '@scriptcable/core/wasm';
import type { ScriptcableProfile, EngineClient } from '@scriptcable/types';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { sharedLibraryFileName } from '@scriptcable/core';

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
  ) as ScriptcableProfile;
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
    throw new (await import('@scriptcable/types')).ScriptcableError(
      'MISSING_ARTIFACT',
      `No native shared library (${soPath}) or WASM (${wasmPath}) found.`,
      'Run: scriptcable build   (native default)  or  scriptcable build --target wasm',
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
