/**
 * @scriptcable/vite — Vite plugin: builds scriptc core (WASM) on startup and HMR.
 *
 * Zero-config: reads scriptcable.config.ts > scriptcable.json > inference
 * (package.json name + standard entry locations) unless `configPath` is set.
 */
import { resolve, join } from 'node:path';
import type { ResolvedConfig } from '@scriptcable/types';
import { buildCore, loadProjectConfig, loadConfigFile, writeGeneratedClients } from '@scriptcable/core';

export type ScriptcableViteOptions = {
  /** Explicit config file (.ts or .json) — default: auto-discover or infer */
  configPath?: string;
  /** Virtual module id for the generated client */
  virtualId?: string;
};

type VitePlugin = {
  name: string;
  configResolved?: (config: { root: string }) => void;
  buildStart?: () => Promise<void>;
  resolveId?: (id: string) => string | null;
  load?: (id: string) => Promise<string | null> | string | null;
  handleHotUpdate?: (ctx: {
    file: string;
    server: { ws: { send: (msg: unknown) => void }; restart: () => Promise<void> };
  }) => Promise<void> | void;
};

async function loadProject(root: string, configPath?: string): Promise<ResolvedConfig> {
  if (configPath) return loadConfigFile(resolve(root, configPath), root);
  return (await loadProjectConfig(root)).config;
}

async function rebuild(root: string, configPath?: string): Promise<{ genDir: string; config: ResolvedConfig }> {
  const config = await loadProject(root, configPath);
  const outDir = resolve(root, config.outDir ?? '.scriptcable');
  const result = await buildCore(config, { cwd: root, outDir, target: config.target === 'wasm' ? 'wasm' : 'both' });
  const { genDir, clientLink } = await writeGeneratedClients({
    config,
    targets: ['browser', 'node'],
    outDir,
    cwd: root,
    wasmFileName: `${config.name}.wasm`,
    copy: { wasmPath: result.wasmPath, sharedPath: result.sharedPath, addonPath: result.addonPath },
    profile: result.profile,
  });
  if (clientLink === 'blocked') {
    console.warn('[scriptcable] could not link node_modules/@scriptcable/client — run `scriptcable doctor`');
  }
  return { genDir, config };
}

export function scriptcable(options: ScriptcableViteOptions = {}): VitePlugin {
  const configPath = options.configPath;
  const virtualId = options.virtualId ?? 'virtual:scriptcable';
  let root = process.cwd();
  let genDir = '';
  // Cached resolved entry — lets handleHotUpdate skip config resolution
  // (a cache-busting dynamic import) for unrelated HMR events.
  let lastEntryAbs = '';

  return {
    name: 'vite-plugin-scriptcable',
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      const r = await rebuild(root, configPath);
      genDir = r.genDir;
    },
    resolveId(id) {
      if (id !== virtualId && id !== '@scriptcable/client') return null;
      // Resolve to the real browser client so it stays inside vite's module
      // graph and gets transformed. (A virtual re-export of its absolute
      // path serves raw, untransformed TS to the browser.)
      return genDir ? join(genDir, 'browser.ts') : null;
    },
    async handleHotUpdate(ctx) {
      const isConfigFile =
        ctx.file === resolve(root, 'scriptcable.config.ts') ||
        ctx.file === resolve(root, 'scriptcable.json') ||
        (configPath !== undefined && ctx.file === resolve(root, configPath));
      if (!isConfigFile && !/\.(ts|js)$/.test(ctx.file)) return;
      // Only resolve the config when the file could be the entry (or is a config)
      if (!isConfigFile && lastEntryAbs && ctx.file !== lastEntryAbs) return;
      // Rebuild when the config or the core entry changes
      try {
        const config = await loadProject(root, configPath);
        lastEntryAbs = resolve(root, config.entry);
        if (isConfigFile || ctx.file === lastEntryAbs) {
          await rebuild(root, configPath);
          ctx.server.ws.send({ type: 'full-reload' });
        }
      } catch {
        /* ignore */
      }
    },
  };
}

export default scriptcable;
