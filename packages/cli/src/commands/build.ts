import { resolve } from 'node:path';
import { buildCore, snapshotFromProfile, loadProjectConfig, loadConfigFile, writeGeneratedClients } from '@scriptcable/core';
import { resolveProfile } from '@scriptcable/core';
import { type CodegenTarget } from '@scriptcable/core/codegen';

export type BuildCliOptions = {
  cwd?: string;
  target?: 'wasm' | 'native' | 'both';
  hosts?: CodegenTarget[];
  /** Explicit config path (.ts or .json) — defaults to scriptcable.config.ts, scriptcable.json, or zero-config inference */
  configPath?: string;
  /** Bypass the build cache */
  force?: boolean;
};

export async function runBuild(opts: BuildCliOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const config = opts.configPath
    ? await loadConfigFile(resolve(cwd, opts.configPath), cwd)
    : (await loadProjectConfig(cwd)).config;
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
  const { genDir, clientLink } = await writeGeneratedClients({
    config,
    targets: hosts,
    outDir,
    cwd,
    profile: result.profile,
    wasmFileName: wasmName,
    copy: { wasmPath: result.wasmPath, sharedPath: result.sharedPath },
  });

  const snap = snapshotFromProfile(result.profile);
  console.log(`  profile:   ${result.profilePath}`);
  if (result.nativePath) console.log(`  native:    ${result.nativePath}`);
  if (result.sharedPath) console.log(`  shared:    ${result.sharedPath}`);
  if (result.wasmPath) console.log(`  wasm:      ${result.wasmPath}`);
  console.log(`  generated: ${genDir}`);
  console.log(
    clientLink === 'blocked'
      ? `  client:    node_modules link unavailable — run \`scriptcable doctor\` for details`
      : `  client:    import { createClient } from '@scriptcable/client'`,
  );
  console.log(`  contract:  ${snap.hash}`);
  return 0;
}
