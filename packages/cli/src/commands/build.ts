import { resolve, join } from 'node:path';
import { stat } from 'node:fs/promises';
import {
  buildCore,
  snapshotFromProfile,
  loadProjectConfig,
  loadConfigFile,
  writeGeneratedClients,
  collectSourceGraph,
} from '@scriptcable/core';
import { type CodegenTarget } from '@scriptcable/core/codegen';
import { formatError } from '../errors.js';

export type BuildCliOptions = {
  cwd?: string;
  target?: 'wasm' | 'native' | 'both';
  hosts?: CodegenTarget[];
  /** Explicit config path (.ts or .json) — defaults to scriptcable.config.ts, scriptcable.json, or zero-config inference */
  configPath?: string;
  /** Bypass the build cache */
  force?: boolean;
  /** Keep running and rebuild automatically when the core sources or config change */
  watch?: boolean;
};

/** Poll cadence for `--watch` — source saves coalesce into one rebuild. */
const WATCH_POLL_MS = 400;

async function resolveConfig(cwd: string, configPath?: string) {
  return configPath
    ? await loadConfigFile(resolve(cwd, configPath), cwd)
    : (await loadProjectConfig(cwd)).config;
}

export async function runBuild(opts: BuildCliOptions = {}): Promise<number> {
  if (opts.watch) return runWatch(opts);
  await buildAndEmit(opts, true);
  return 0;
}

async function buildAndEmit(opts: BuildCliOptions, announce: boolean): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const config = await resolveConfig(cwd, opts.configPath);
  const outDir = resolve(cwd, config.outDir ?? '.scriptcable');

  const target = opts.target ?? config.target ?? 'native';
  if (announce) console.log(`Building ${config.name} (${target})…`);
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
    copy: { wasmPath: result.wasmPath, sharedPath: result.sharedPath, addonPath: result.addonPath },
  });

  const snap = snapshotFromProfile(result.profile);
  console.log(`  profile:   ${result.profilePath}`);
  if (result.nativePath) console.log(`  native:    ${result.nativePath}`);
  if (result.sharedPath) console.log(`  shared:    ${result.sharedPath}`);
  if (result.addonPath) console.log(`  addon:     ${result.addonPath} (typed N-API direct binding)`);
  if (result.wasmPath) console.log(`  wasm:      ${result.wasmPath}`);
  console.log(`  generated: ${genDir}`);
  console.log(
    clientLink === 'blocked'
      ? `  client:    node_modules link unavailable — run \`scriptcable doctor\` for details`
      : `  client:    import { createClient } from '@scriptcable/client'`,
  );
  console.log(`  contract:  ${snap.hash}`);
}

type Stamps = Map<string, number>;

/**
 * Watch mode: rebuild on change, for hosts without their own watcher (Next
 * Turbopack predev, Bun/Node apps). Polls the same inputs the build cache
 * hashes — the entry plus its same-directory siblings and the config files —
 * so what triggers a rebuild is exactly what can change the artifacts.
 */
async function runWatch(opts: BuildCliOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();

  let config;
  try {
    config = await resolveConfig(cwd, opts.configPath);
  } catch (e) {
    console.error(formatError(e));
    return 1;
  }

  try {
    await buildAndEmit(opts, true);
  } catch (e) {
    // A broken core still watches — fixing the file triggers the rebuild.
    console.error(formatError(e));
    console.log('  still watching — fix the error to rebuild');
  }
  console.log(`watching for changes — Ctrl+C to stop`);

  const configFiles = () => {
    const files = [join(cwd, 'scriptcable.config.ts'), join(cwd, 'scriptcable.json')];
    if (opts.configPath) files.push(resolve(cwd, opts.configPath));
    return files;
  };
  // The build cache's input set — the import graph rooted at the entry plus
  // its same-directory siblings. One collector, so watch and cache agree.
  const watchedSources = async (): Promise<string[]> => {
    try {
      return await collectSourceGraph(resolve(cwd, config.entry));
    } catch {
      return [];
    }
  };
  const stampOf = async (paths: string[]): Promise<Stamps> => {
    const stamps: Stamps = new Map();
    await Promise.all(
      paths.map(async (p) => {
        try {
          stamps.set(p, (await stat(p)).mtimeMs);
        } catch {
          stamps.set(p, -1); // deleted / not there yet
        }
      }),
    );
    return stamps;
  };
  const differs = (a: Stamps, b: Stamps): boolean =>
    a.size !== b.size || [...a].some(([k, v]) => b.get(k) !== v);

  let configStamps = await stampOf(configFiles());
  let sourceStamps = await stampOf(await watchedSources());
  let building = false;

  const tick = async (): Promise<void> => {
    if (building) return;
    building = true;
    try {
      const nextConfigStamps = await stampOf(configFiles());
      const nextSourceStamps = await stampOf(await watchedSources());
      if (!differs(nextConfigStamps, configStamps) && !differs(nextSourceStamps, sourceStamps)) return;
      configStamps = nextConfigStamps;
      sourceStamps = nextSourceStamps;
      const started = Date.now();
      await buildAndEmit(opts, false);
      console.log(`  rebuilt in ${Date.now() - started}ms — watching…`);
    } catch (e) {
      // Mid-edit source/config — report and keep watching; the next save
      // changes the stamps again and triggers a fresh rebuild attempt.
      console.error(formatError(e));
      console.log('  still watching — fix the error to rebuild');
    } finally {
      building = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, WATCH_POLL_MS);
  await new Promise<void>((stopWaiting) => {
    const stop = () => {
      clearInterval(timer);
      console.log('\nwatch stopped');
      stopWaiting();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}
