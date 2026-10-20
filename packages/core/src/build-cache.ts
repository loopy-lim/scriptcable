/**
 * Content-addressed build cache for scriptcable builds.
 *
 * A build is a cache hit when the hash of (entry sources + profile + target)
 * matches the previous successful build. Hits skip the scriptc compile and
 * the shared-library link entirely.
 */
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile, access } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type { ScriptcaConfig, ScriptcaProfile } from '@scriptcable/types';

const CACHE_FILE = 'build-cache.json';

export type BuildCacheEntry = {
  target: 'native' | 'wasm' | 'both';
  /** sha256 of sources + profile + tool inputs */
  hash: string;
  savedAt: number;
};

export type BuildCacheData = {
  version: 1;
  entries: Record<string, BuildCacheEntry>;
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Hash a file's contents, or return null when missing. */
async function hashFile(path: string): Promise<string | null> {
  try {
    const data = await readFile(path);
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

async function collectSourceHashes(
  entryAbs: string,
  extraPaths: string[],
): Promise<string[]> {
  const hashes: string[] = [];
  // Hash the entry plus reachable same-dir .ts files (scriptc compiles the
  // module graph rooted at the entry; same-dir sources are the common case).
  const seen = new Set<string>();
  const queue = [entryAbs];
  while (queue.length) {
    const file = queue.shift()!;
    const norm = resolve(file);
    if (seen.has(norm)) continue;
    seen.add(norm);
    const h = await hashFile(norm);
    if (h === null) continue;
    hashes.push(`${relative(dirname(entryAbs), norm)}:${h}`);
    // Include sibling sources in the same directory (conservative shallow graph)
    const dir = dirname(norm);
    const { readdir } = await import('node:fs/promises');
    let siblings: string[] = [];
    try {
      siblings = (await readdir(dir)).filter(
        (f) => /\.ts$/.test(f) && !/\.test\./.test(f) && !/\.bench\./.test(f),
      );
    } catch {
      siblings = [];
    }
    for (const s of siblings) queue.push(join(dir, s));
    if (seen.size > 64) break; // safety bound
  }
  for (const p of extraPaths) {
    const h = await hashFile(p);
    hashes.push(`${p}:${h ?? 'missing'}`);
  }
  return hashes;
}

/** Compute the cache key for a build. */
export async function computeBuildHash(options: {
  cwd: string;
  config: ScriptcaConfig;
  profile: ScriptcaProfile;
  target: 'native' | 'wasm' | 'both';
  extraInputs?: string[];
}): Promise<string> {
  const entryAbs = resolve(options.cwd, options.config.entry);
  const sourceHashes = await collectSourceHashes(entryAbs, options.extraInputs ?? []);
  const surface = JSON.stringify({
    name: options.config.name,
    prefix: options.config.prefix,
    exports: options.config.exports,
    callbacks: options.config.callbacks ?? [],
    optimization: options.config.optimization ?? 'release',
    target: options.target,
    sources: sourceHashes.sort(),
  });
  return createHash('sha256').update(surface).digest('hex').slice(0, 32);
}

async function readCache(outDir: string): Promise<BuildCacheData> {
  const path = join(outDir, CACHE_FILE);
  if (!(await exists(path))) return { version: 1, entries: {} };
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as BuildCacheData;
    if (raw.version === 1 && raw.entries) return raw;
  } catch {
    /* corrupt cache — treat as empty */
  }
  return { version: 1, entries: {} };
}

/** True when (target,hash) matches the last successful build AND its artifacts still exist. */
export async function isCachedBuild(options: {
  outDir: string;
  target: 'native' | 'wasm' | 'both';
  hash: string;
  artifactPaths: string[];
}): Promise<boolean> {
  const cache = await readCache(options.outDir);
  const entry = cache.entries[options.target];
  if (!entry || entry.hash !== options.hash) return false;
  for (const p of options.artifactPaths) {
    if (!(await exists(p))) return false;
  }
  return true;
}

/** Record a successful build in the cache. */
export async function markBuildDone(options: {
  outDir: string;
  target: 'native' | 'wasm' | 'both';
  hash: string;
}): Promise<void> {
  const cache = await readCache(options.outDir);
  cache.entries[options.target] = { target: options.target, hash: options.hash, savedAt: Date.now() };
  await writeFile(join(options.outDir, CACHE_FILE), JSON.stringify(cache, null, 2) + '\n');
}

/** Latest cache timestamp (for diagnostics). */
export async function cacheInfo(outDir: string): Promise<BuildCacheData | null> {
  return readCache(outDir);
}

/** Exported for tests. */
export async function statMtime(path: string): Promise<number> {
  const s = await stat(path);
  return s.mtimeMs;
}
