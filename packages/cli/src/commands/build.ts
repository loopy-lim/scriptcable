import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { buildCore, snapshotFromProfile, loadProjectConfig } from '@scriptcable/core';
import { resolveProfile } from '@scriptcable/core';
import { generateClients, type CodegenTarget } from '@scriptcable/core/codegen';

export type BuildCliOptions = {
  cwd?: string;
  target?: 'wasm' | 'native' | 'both';
  hosts?: CodegenTarget[];
  /** Explicit config path — defaults to scriptcable.config.ts then scriptcable.json */
  configPath?: string;
  /** Bypass the build cache */
  force?: boolean;
};

export async function runBuild(opts: BuildCliOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  let config;
  if (opts.configPath) {
    const { loadConfig } = await import('@scriptcable/core');
    config = loadConfig(JSON.parse(await readFile(resolve(cwd, opts.configPath), 'utf8')));
  } else {
    ({ config } = await loadProjectConfig(cwd));
  }
  const outDir = resolve(cwd, config.outDir ?? '.scriptcable');

  const target = opts.target ?? config.target ?? 'native';
  console.log(`Building ${config.name} (${target})…`);
  const result = await buildCore(config, {
    cwd,
    target,
    outDir,
    force: opts.force,
  });

  if (result.cached) {
    console.log('  cache:     HIT — inputs unchanged, skipped scriptc + link (use --force to rebuild)');
  }

  const hosts = opts.hosts ?? (['node', 'bun', 'browser'] as CodegenTarget[]);
  const wasmName = `${config.name}.wasm`;
  const generated = generateClients(config, hosts, { wasmFileName: wasmName, profile: result.profile });
  const genDir = join(outDir, 'generated');
  await mkdir(genDir, { recursive: true });
  let wroteFiles = 0;
  for (const [name, body] of Object.entries(generated.files)) {
    const path = join(genDir, name);
    // Skip identical content so editors/watchers don't see spurious changes
    try {
      const prev = await readFile(path, 'utf8');
      if (prev === body) continue;
    } catch {
      /* not written yet */
    }
    await writeFile(path, body);
    wroteFiles++;
  }

  // Copy artifacts next to generated clients for relative imports
  async function copyIfChanged(src: string, dest: string): Promise<void> {
    try {
      const [a, b] = await Promise.all([readFile(src), readFile(dest)]);
      if (a.equals(b)) return;
    } catch {
      /* copy below */
    }
    await copyFile(src, dest);
  }
  if (result.sharedPath) {
    await copyIfChanged(result.sharedPath, join(genDir, basename(result.sharedPath)));
  }
  if (result.wasmPath) {
    await copyIfChanged(result.wasmPath, join(genDir, wasmName));
  }

  const snap = snapshotFromProfile(result.profile);
  console.log(`  profile:   ${result.profilePath}`);
  if (result.nativePath) console.log(`  native:    ${result.nativePath}`);
  if (result.sharedPath) console.log(`  shared:    ${result.sharedPath}`);
  if (result.wasmPath) console.log(`  wasm:      ${result.wasmPath}`);
  console.log(`  generated: ${genDir}`);
  console.log(`  contract:  ${snap.hash}`);
  return 0;
}
