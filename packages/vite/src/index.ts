/**
 * @scriptcable/vite — Vite plugin: builds scriptc core (WASM) on startup and HMR.
 *
 * Zero-config: reads scriptcable.config.ts > scriptcable.json > inference
 * (package.json name + standard entry locations) unless `configPath` is set.
 *
 * Drop-in interception (default on): module imports that resolve to the core
 * entry are redirected onto the generated drop-in client, so app code keeps
 * importing `./core` while the bundle runs the compiled WASM. Disable with
 * `dropin: false`.
 */
import { resolve, join } from 'node:path';
import type { ResolvedConfig } from '@scriptcable/types';
import {
  buildCore,
  loadProjectConfig,
  loadConfigFile,
  writeGeneratedClients,
  copyWasmToPublicDir,
  canInterceptEntry,
} from '@scriptcable/core';

export type ScriptcableViteOptions = {
  /** Explicit config file (.ts or .json) — default: auto-discover or infer */
  configPath?: string;
  /** Virtual module id for the generated client */
  virtualId?: string;
  /** Redirect entry imports onto the compiled client (default: true) */
  dropin?: boolean;
};

type ViteResolve = (
  id: string,
  importer?: string,
  opts?: { skipSelf?: boolean },
) => Promise<{ id: string } | null> | { id: string } | null;

type VitePlugin = {
  name: string;
  configResolved?: (config: {
    root: string;
    publicDir?: string | false;
    command?: string;
    build?: { target?: unknown };
  }) => void;
  buildStart?: () => Promise<void>;
  resolveId?:
    | ((this: { resolve: ViteResolve }, id: string, importer?: string) => Promise<string | null> | string | null)
    | {
        /** Runs before vite:resolve — the builtin would otherwise answer relative imports first. */
        order: 'pre';
        handler: (this: { resolve: ViteResolve }, id: string, importer?: string) => Promise<string | null> | string | null;
      };
  load?: (id: string) => Promise<string | null> | string | null;
  handleHotUpdate?: (ctx: {
    file: string;
    server: { ws: { send: (msg: unknown) => void }; restart: () => Promise<void> };
  }) => Promise<void> | void;
};

/** Drop-in interception state, refreshed on every rebuild. */
type DropinState = { enabled: boolean; entryAbs: string; path: string };

/** A vite build target string can run top-level await (the drop-in browser init)? */
function targetSupportsTla(target: string): boolean {
  if (/^es(next|\d+)$/.test(target)) {
    const year = Number.parseInt(target.slice(2), 10);
    return Number.isNaN(year) || year >= 2022;
  }
  // vite's shorthand targets, expanded to their browser pins
  const expanded =
    target === 'modules'
      ? ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14']
      : target === 'baseline-widely-available'
        ? ['chrome107', 'edge107', 'firefox104', 'safari16']
        : [target];
  return expanded.every((t) => {
    const m = /^([a-z]+)(\d+)$/.exec(t);
    if (!m) return true; // unknown form — permissive, es-branch handled above
    const min: Record<string, number> = { chrome: 89, edge: 89, opera: 75, firefox: 89, safari: 15, node: 16 };
    const floor = min[m[1]!];
    return floor === undefined ? true : Number.parseInt(m[2]!, 10) >= floor;
  });
}

/**
 * vite's default build target by major: 5/6 pin `modules` (safari 14 — no
 * TLA), 7+ uses `baseline-widely-available` (safari 16 — fine). Reads the
 * installed peer; conservative `modules` when unavailable.
 */
async function defaultBuildTargets(): Promise<string[]> {
  try {
    const vite = (await import('vite')) as { version?: string };
    const major = Number.parseInt((vite.version ?? '6').split('.')[0]!, 10);
    return [major >= 7 ? 'baseline-widely-available' : 'modules'];
  } catch {
    return ['modules'];
  }
}

async function loadProject(root: string, configPath?: string): Promise<ResolvedConfig> {
  if (configPath) return loadConfigFile(resolve(root, configPath), root);
  return (await loadProjectConfig(root)).config;
}

async function rebuild(
  root: string,
  configPath: string | undefined,
  publicDir: string | undefined,
  dropin: DropinState,
  dropinOpt: boolean,
  buildGate: { command: string; target: unknown },
): Promise<{ genDir: string; config: ResolvedConfig }> {
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
  // Copy the wasm into public/ so `vite build` (dist) serves it at
  // /<name>.wasm — in dev the module-relative URL already resolves.
  if (result.wasmPath && publicDir) {
    const copied = await copyWasmToPublicDir({
      publicDir,
      wasmPath: result.wasmPath,
      wasmName: `${config.name}.wasm`,
    });
    if (copied === 'written') {
      console.log(`[scriptcable] browser wasm → public/${config.name}.wasm (served at /${config.name}.wasm)`);
    }
  }
  // Drop-in: imports of the entry resolve to the compiled client. Only when
  // the drop-in can provide the entry's whole runtime export surface — and,
  // for `vite build`, when the target can run the TLA-based browser init.
  if (dropinOpt) {
    const check = await canInterceptEntry(config, root, result.profile);
    let blockedBy: string | null = null;
    if (!check.ok) {
      blockedBy = check.reasons.join('; ');
    } else if (buildGate.command === 'build') {
      const targets = Array.isArray(buildGate.target)
        ? (buildGate.target as string[])
        : [(buildGate.target as string | undefined) ?? (await defaultBuildTargets())[0] ?? 'modules'];
      if (!targets.every(targetSupportsTla)) {
        blockedBy =
          `build.target ${JSON.stringify(targets)} can't run top-level await — ` +
          `set build.target: 'es2022' (TLA ships in Chrome 89+/Safari 15+/Firefox 89+) or pass dropin: false`;
      }
    }
    if (blockedBy === null) {
      dropin.enabled = true;
      dropin.entryAbs = resolve(root, config.entry);
      dropin.path = join(genDir, 'dropin', 'browser.ts');
      console.log(`[scriptcable] drop-in: imports of ${config.entry} resolve to the compiled client (browser wasm)`);
    } else {
      dropin.enabled = false;
      console.warn(`[scriptcable] drop-in disabled — ${blockedBy}`);
    }
  } else {
    dropin.enabled = false;
  }
  if (clientLink === 'blocked') {
    console.warn('[scriptcable] could not link node_modules/@scriptcable/client — run `scriptcable doctor`');
  }
  return { genDir, config };
}

export function scriptcable(options: ScriptcableViteOptions = {}): VitePlugin {
  const configPath = options.configPath;
  const dropinOpt = options.dropin !== false;
  const virtualId = options.virtualId ?? 'virtual:scriptcable';
  let root = process.cwd();
  let publicDir = '';
  let genDir = '';
  const dropin: DropinState = { enabled: false, entryAbs: '', path: '' };
  const buildGate: { command: string; target: unknown } = { command: 'serve', target: undefined };
  // Cached resolved entry — lets handleHotUpdate skip config resolution
  // (a cache-busting dynamic import) for unrelated HMR events.
  let lastEntryAbs = '';

  return {
    name: 'vite-plugin-scriptcable',
    configResolved(config) {
      root = config.root;
      // publicDir: false is explicit — the user wants no static dir; don't
      // fabricate one for the wasm copy.
      publicDir =
        typeof config.publicDir === 'string' && config.publicDir
          ? config.publicDir
          : config.publicDir === false
            ? ''
            : join(root, 'public');
      buildGate.command = config.command ?? 'serve';
      buildGate.target = config.build?.target;
    },
    async buildStart() {
      const r = await rebuild(root, configPath, publicDir, dropin, dropinOpt, buildGate);
      genDir = r.genDir;
    },
    resolveId: {
      // order 'pre': vite's builtin vite:resolve otherwise answers relative
      // imports before user plugins are consulted — the drop-in would never
      // see them.
      order: 'pre',
      async handler(id, importer) {
        if (id === virtualId || id === '@scriptcable/client') {
          // Resolve to the real browser client so it stays inside vite's module
          // graph and gets transformed. (A virtual re-export of its absolute
          // path serves raw, untransformed TS to the browser.)
          return genDir ? join(genDir, 'browser.ts') : null;
        }
        // Drop-in: redirect module imports that resolve to the core entry.
        if (!dropin.enabled || !importer || id.startsWith('\0')) return null;
        let resolved: { id: string } | null;
        try {
          resolved = await this.resolve(id, importer, { skipSelf: true });
        } catch {
          return null;
        }
        if (resolved && resolved.id === dropin.entryAbs) return dropin.path;
        return null;
      },
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
          await rebuild(root, configPath, publicDir, dropin, dropinOpt, buildGate);
          ctx.server.ws.send({ type: 'full-reload' });
        }
      } catch {
        /* ignore */
      }
    },
  };
}

export default scriptcable;
