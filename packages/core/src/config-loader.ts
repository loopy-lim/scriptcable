/**
 * Config loading: scriptcable.config.ts (preferred — typed, commented) or
 * scriptcable.json (zero-config classic).
 *
 * Because the CLI runs on Bun, a .ts config is imported directly — no
 * transpile step, full type-checking in the editor via `defineConfig`.
 */
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ScriptcableConfig } from '@scriptcable/types';
import { loadConfig } from './profile.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export type LoadedConfig = {
  config: ScriptcableConfig;
  /** Which file the config came from */
  source: 'scriptcable.config.ts' | 'scriptcable.json';
};

/**
 * Load the project config from `cwd`.
 * Priority: scriptcable.config.ts > scriptcable.json.
 */
export async function loadProjectConfig(cwd = process.cwd()): Promise<LoadedConfig> {
  const tsPath = join(cwd, 'scriptcable.config.ts');
  if (await exists(tsPath)) {
    const mod = await import(`${tsPath}?t=${Date.now()}`); // bust loader cache
    const def = mod.default;
    if (!def) {
      throw new Error('scriptcable.config.ts must have a default export (use defineConfig({ ... }))');
    }
    // Reuse the same validation as JSON configs
    return { config: loadConfig(def), source: 'scriptcable.config.ts' };
  }

  const jsonPath = join(cwd, 'scriptcable.json');
  if (await exists(jsonPath)) {
    const { readFile } = await import('node:fs/promises');
    const raw = JSON.parse(await readFile(jsonPath, 'utf8'));
    return { config: loadConfig(raw), source: 'scriptcable.json' };
  }

  throw new Error(
    'No config found. Create scriptcable.config.ts (typed, recommended) or scriptcable.json in the project root.\n' +
      'Minimal example:\n\n' +
      '  // scriptcable.config.ts\n' +
      '  import { defineConfig } from "@scriptcable/core";\n' +
      '  export default defineConfig({ name: "mycore", entry: "src/core.ts" });\n',
  );
}

/**
 * Type-safe config authoring helper for scriptcable.config.ts.
 *
 * ```ts
 * import { defineConfig } from '@scriptcable/core';
 * export default defineConfig({
 *   name: 'calculator',
 *   entry: 'src/core.ts',
 *   // exports are inferred from the entry's TS types — no duplication
 * });
 * ```
 */
export function defineConfig(config: ScriptcableConfig): ScriptcableConfig {
  return config;
}

export { resolve as resolvePath } from 'node:path';
