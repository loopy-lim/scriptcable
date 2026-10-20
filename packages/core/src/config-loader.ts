/**
 * Config loading: scriptcable.config.ts (preferred — typed, commented) or
 * scriptcable.json.
 *
 * Zero-config: when neither file exists (or they omit `name`/`entry`),
 * values are inferred — `name` from package.json (falling back to the
 * directory name), `entry` from standard locations (src/core.ts > core.ts
 * > src/index.ts > index.ts). See `resolveProjectConfig`.
 *
 * Because the CLI runs on Bun, a .ts config is imported directly — no
 * transpile step, full type-checking in the editor via `defineConfig`.
 */
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ResolvedConfig, ScriptcableConfig } from '@scriptcable/types';
import { loadConfig } from './profile.js';
import { CORE_ENTRY_CANDIDATES, resolveNameEntry } from './defaults.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Where a resolved config came from — `inferred` means no config file at all. */
export type ConfigSource = 'scriptcable.config.ts' | 'scriptcable.json' | 'inferred';

export type ResolvedProjectConfig = {
  config: ResolvedConfig;
  /** Which file the config came from */
  source: ConfigSource;
  /** Fields filled by inference rather than explicit configuration. */
  inferredFields: Array<'name' | 'entry'>;
};

export type LoadedConfig = ResolvedProjectConfig;

/**
 * Load a config from an explicit path (.ts or .json) and resolve it
 * against `cwd`. Used by `--config` flags and bundler-plugin
 * `configPath` options.
 */
export async function loadConfigFile(path: string, cwd = process.cwd()): Promise<ResolvedConfig> {
  let config: ScriptcableConfig;
  if (path.endsWith('.ts')) {
    const abs = resolve(path);
    const mod = await import(`${abs}?t=${Date.now()}`); // bust loader cache
    if (!mod.default) {
      throw new Error(`${path} must have a default export (use defineConfig({ ... }))`);
    }
    config = loadConfig(mod.default);
  } else {
    const { readFile } = await import('node:fs/promises');
    config = loadConfig(JSON.parse(await readFile(path, 'utf8')));
  }
  const { config: resolved } = await resolveNameEntry(config, cwd);
  return resolved as ResolvedConfig;
}

/**
 * Load the project config from `cwd` and resolve it to a complete config:
 * priority scriptcable.config.ts > scriptcable.json > inference.
 * Missing `name`/`entry` are filled from package.json / standard locations.
 */
export async function resolveProjectConfig(cwd = process.cwd()): Promise<ResolvedProjectConfig> {
  let config: ScriptcableConfig;
  let source: ConfigSource = 'inferred';

  const tsPath = join(cwd, 'scriptcable.config.ts');
  if (await exists(tsPath)) {
    const mod = await import(`${tsPath}?t=${Date.now()}`); // bust loader cache
    if (!mod.default) {
      throw new Error('scriptcable.config.ts must have a default export (use defineConfig({ ... }))');
    }
    config = loadConfig(mod.default);
    source = 'scriptcable.config.ts';
  } else {
    const jsonPath = join(cwd, 'scriptcable.json');
    if (await exists(jsonPath)) {
      const { readFile } = await import('node:fs/promises');
      config = loadConfig(JSON.parse(await readFile(jsonPath, 'utf8')));
      source = 'scriptcable.json';
    } else {
      config = {};
    }
  }

  try {
    const { config: resolved, inferredFields } = await resolveNameEntry(config, cwd);
    return { config: resolved as ResolvedConfig, source, inferredFields };
  } catch (err) {
    if (source === 'inferred') {
      // No config file at all — widen the error with scaffold guidance.
      throw new Error(
        `${(err as Error).message}\n` +
          `Create scriptcable.config.ts (typed, recommended) or scriptcable.json, ` +
          `or place your core at one of the searched paths.\n` +
          `Minimal scriptcable.config.ts:\n\n` +
          `  import { defineConfig } from "@scriptcable/core";\n` +
          `  export default defineConfig({ name: "mycore", entry: "src/core.ts" });\n`,
      );
    }
    throw err;
  }
}

/**
 * Load the project config from `cwd`.
 * Priority: scriptcable.config.ts > scriptcable.json > inference.
 */
export async function loadProjectConfig(cwd = process.cwd()): Promise<LoadedConfig> {
  return resolveProjectConfig(cwd);
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
 *   // name/entry may also be omitted (inferred from package.json / src/core.ts)
 * });
 * ```
 */
export function defineConfig(config: ScriptcableConfig): ScriptcableConfig {
  return config;
}

export { resolve as resolvePath } from 'node:path';
