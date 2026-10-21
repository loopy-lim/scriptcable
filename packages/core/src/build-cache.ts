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
import type { ResolvedConfig, ScriptcableProfile } from '@scriptcable/types';

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

/** Relative/static import specifiers in a TS source (over-matches comments — conservative). */
function extractRelativeSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const spec = m[1]!;
    if (spec.startsWith('.') || spec.startsWith('/')) specs.push(spec);
  }
  return specs;
}

/** Resolve one import specifier to a project file (extensionless and `.js`→`.ts` aware). */
async function resolveTsSpecifier(fromFile: string, spec: string): Promise<string | null> {
  const { access } = await import('node:fs/promises');
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`];
  if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
  if (base.endsWith('.mjs')) candidates.push(`${base.slice(0, -4)}.mts`);
  candidates.push(join(base, 'index.ts'), join(base, 'index.tsx'));
  for (const c of candidates) {
    try {
      await access(c);
      return c;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/**
 * The source files a build depends on: the entry, every file reachable
 * through relative/static imports (the graph scriptc compiles), plus the
 * entry's same-directory siblings as a conservative floor (non-literal
 * dynamic imports escape graph tracking). This is THE input set — the
 * build cache hashes it and `build --watch` polls it, so what can change
 * the artifacts is exactly what triggers a rebuild.
 */
export async function collectSourceGraph(entryAbs: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const entry = resolve(entryAbs);
  const entryDir = dirname(entry);
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let source: string | null = null;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    order.push(file);
    for (const spec of extractRelativeSpecifiers(source)) {
      const target = await resolveTsSpecifier(file, spec);
      if (target && !seen.has(target)) queue.push(target);
    }
    // Conservative floor, entry directory only: deeper directories trust the
    // import graph (a per-dir floor would hash unrelated nested files and
    // erase the precision the graph tracking buys).
    if (dirname(file) === entryDir) {
      try {
        const siblings = (await readdir(entryDir)).filter(
          (f) => /\.ts$/.test(f) && !/\.test\./.test(f) && !/\.bench\./.test(f) && !/\.d\.ts$/.test(f),
        );
        for (const s of siblings) {
          const p = join(entryDir, s);
          if (!seen.has(p)) queue.push(p);
        }
      } catch {
        /* unreadable dir — nothing to add */
      }
    }
    if (seen.size > 256) break; // safety bound
  }
  return order;
}

async function collectSourceHashes(
  entryAbs: string,
  extraPaths: string[],
): Promise<string[]> {
  const hashes: string[] = [];
  for (const norm of await collectSourceGraph(entryAbs)) {
    const h = await hashFile(norm);
    if (h === null) continue;
    hashes.push(`${relative(dirname(entryAbs), norm)}:${h}`);
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
  config: ResolvedConfig;
  profile: ScriptcableProfile;
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
