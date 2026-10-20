/**
 * Zero-config defaults: infer the project name and core entry when the
 * config file doesn't provide them, so `scriptcable build` works with no
 * scriptcable config at all. Explicit config values always win.
 *
 * Kept free of imports from config-loader/profile so both can use it
 * without an import cycle.
 */
import { access, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** Candidate core entry locations, in priority order. */
export const CORE_ENTRY_CANDIDATES = ['src/core.ts', 'core.ts', 'src/index.ts', 'index.ts'];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** First standard core entry that exists in `cwd`, or null. */
export async function findCoreEntry(cwd: string): Promise<string | null> {
  for (const candidate of CORE_ENTRY_CANDIDATES) {
    if (await exists(join(cwd, candidate))) return candidate;
  }
  return null;
}

/**
 * Project name for ABI prefixing: package.json `name` when readable,
 * otherwise the directory name. Slugified to a C-identifier-friendly form.
 */
export async function inferProjectName(cwd: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
      name?: unknown;
    };
    if (typeof pkg?.name === 'string' && pkg.name) return slugPackageName(pkg.name);
  } catch {
    /* no package.json or invalid JSON — fall through to directory name */
  }
  return slugPackageName(basename(cwd));
}

/** Scope-aware slug: `@scope/my-pkg` → `scope_my_pkg`, safe for C symbols. */
export function slugPackageName(name: string): string {
  return (
    name
      .replace(/[@/]/g, '_')
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/^_+/, '')
      .toLowerCase() || 'app'
  );
}

/**
 * Fill in omitted `entry`/`name` on a partial config from standard
 * locations / package.json. Explicit values always win. The single
 * resolution point used by `resolveProjectConfig` and `resolveProfile`.
 */
export async function resolveNameEntry(
  config: Partial<{ name?: string; entry?: string }> & Record<string, unknown>,
  cwd: string,
): Promise<{ config: { name: string; entry: string } & Record<string, unknown>; inferredFields: Array<'name' | 'entry'> }> {
  let resolved = config as { name?: string; entry?: string } & Record<string, unknown>;
  const inferredFields: Array<'name' | 'entry'> = [];
  if (!resolved.entry) {
    const entry = await findCoreEntry(cwd);
    if (!entry) {
      throw new Error(
        `No core entry found: no config "entry" and none of ` +
          `${CORE_ENTRY_CANDIDATES.join(', ')} exist in ${cwd}.`,
      );
    }
    resolved = { ...resolved, entry };
    inferredFields.push('entry');
  }
  if (!resolved.name) {
    resolved = { ...resolved, name: await inferProjectName(cwd) };
    inferredFields.push('name');
  }
  return { config: resolved as { name: string; entry: string } & Record<string, unknown>, inferredFields };
}
