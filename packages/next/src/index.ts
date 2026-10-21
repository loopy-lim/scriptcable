/**
 * @scriptcable/next — Next.js integration (Webpack & Turbopack-friendly).
 *
 * Zero-config: reads scriptcable.config.ts > scriptcable.json > inference
 * (package.json name + standard entry locations) unless `configPath` is set.
 *
 * Turbopack does not support arbitrary Webpack plugins the same way, so we
 * expose:
 * 1. `withScriptcable(nextConfig)` — Webpack plugin path for `next build` / `next dev` (webpack).
 * 2. `scriptcableBuild()` — call from `instrumentation.ts` or a prebuild script for Turbopack.
 * 3. `withScriptcableAsync(nextConfig)` — same, plus a Turbopack `resolveAlias`
 *    that redirects entry imports onto the drop-in client (awaitable config).
 *
 * Drop-in interception (default on, webpack path): client graphs redirect
 * entry imports onto the browser drop-in (top-level await), server/edge
 * graphs onto the node drop-in (synchronous init — no await anywhere).
 */
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { ResolvedConfig } from '@scriptcable/types';
import {
  buildCore,
  loadProjectConfig,
  loadConfigFile,
  resolveProfile,
  writeGeneratedClients,
  ensureWasmArtifact,
  copyWasmToPublicDir,
  canInterceptEntry,
  ScriptcableDropinResolvePlugin,
} from '@scriptcable/core';

export type WithScriptcableOptions = {
  /** Explicit config file (.ts or .json) — default: auto-discover or infer */
  configPath?: string;
  /** Redirect entry imports onto the compiled client (default: true) */
  dropin?: boolean;
};

type ScriptcableBuildOutput = {
  genDir: string;
  /** Absolute entry path + drop-in file for the requested flavor ('' when disabled). */
  entryAbs: string;
  dropinPath: string;
};

async function runScriptcableBuild(
  projectRoot: string,
  configPath: string | undefined,
  dropinFlavor: 'browser' | 'node' | false,
): Promise<ScriptcableBuildOutput> {
  const config = configPath
    ? await loadConfigFile(resolve(projectRoot, configPath), projectRoot)
    : (await loadProjectConfig(projectRoot)).config;
  const outDir = resolve(projectRoot, config.outDir ?? '.scriptcable');
  const result = await buildCore(config, { cwd: projectRoot, outDir, target: 'native' });
  // The generated browser flavor needs the WASM artifact — ensure it (built
  // automatically on first use, cached afterwards) and copy it into public/
  // so `createClient()` works in client graphs with no manual copy step.
  const wasmPath = result.wasmPath ?? (await ensureWasmArtifact(config, { cwd: projectRoot, outDir }));
  if (wasmPath) {
    const copied = await copyWasmToPublicDir({
      publicDir: join(projectRoot, 'public'),
      wasmPath,
      wasmName: `${config.name}.wasm`,
    });
    if (copied === 'written') {
      console.log(`[scriptcable] browser wasm → public/${config.name}.wasm (served at /${config.name}.wasm)`);
    }
  }
  const { genDir, clientLink } = await writeGeneratedClients({
    config,
    targets: ['node', 'browser'],
    outDir,
    cwd: projectRoot,
    wasmFileName: `${config.name}.wasm`,
    copy: { sharedPath: result.sharedPath, wasmPath, addonPath: result.addonPath },
    profile: result.profile,
  });
  if (clientLink === 'blocked') {
    console.warn('[scriptcable] could not link node_modules/@scriptcable/client — run `scriptcable doctor`');
  }
  // Drop-in: imports of the entry resolve to the compiled client. Only when
  // the drop-in can provide the entry's whole runtime export surface.
  let entryAbs = '';
  let dropinPath = '';
  if (dropinFlavor) {
    const check = await canInterceptEntry(config, projectRoot, result.profile);
    if (check.ok) {
      entryAbs = resolve(projectRoot, config.entry);
      dropinPath = join(genDir, 'dropin', `${dropinFlavor}.ts`);
      console.log(`[scriptcable] drop-in: imports of ${config.entry} resolve to the compiled ${dropinFlavor} client`);
    } else {
      console.warn(`[scriptcable] drop-in disabled — ${check.reasons.join('; ')}`);
    }
  }
  return { genDir, entryAbs, dropinPath };
}

/** Prebuild helper — works with Turbopack (`next dev --turbo`) via npm script. */
export async function scriptcableBuild(
  options: WithScriptcableOptions & { cwd?: string } = {},
): Promise<string> {
  const { genDir } = await runScriptcableBuild(options.cwd ?? process.cwd(), options.configPath, false);
  return genDir;
}

type NextConfig = Record<string, unknown> & {
  webpack?: (config: any, ctx: any) => any;
  transpilePackages?: string[];
  turbopack?: Record<string, unknown> & { resolveAlias?: Record<string, string> };
};

/**
 * Lazy gate for the webpack resolve chain: pushed into `resolve.plugins` at
 * config time, it only wires the real redirect once the beforeCompile build
 * has produced the entry + drop-in paths (and proven interceptability).
 */
function dropinGate(state: { entryAbs: string; dropinPath: string }) {
  return {
    name: 'ScriptcableDropinResolvePlugin',
    apply(resolver: Parameters<ScriptcableDropinResolvePlugin['apply']>[0]): void {
      if (!state.entryAbs || !state.dropinPath) return;
      new ScriptcableDropinResolvePlugin(state.entryAbs, state.dropinPath).apply(resolver);
    },
  };
}

export function withScriptcable(
  nextConfig: NextConfig = {},
  options: WithScriptcableOptions = {},
): NextConfig {
  const configPath = options.configPath;
  const dropinEnabled = options.dropin !== false;
  return {
    ...nextConfig,
    // The generated client package ships plain .ts — both webpack and
    // Turbopack need it transpiled. Honors packages the app already lists.
    transpilePackages: [...new Set([...(nextConfig.transpilePackages ?? []), '@scriptcable/client'])],
    webpack(config: any, ctx: any) {
      // Per-graph drop-in flavor: client components bundle for the browser
      // (top-level-await init); nodejs server graphs stay await-free. The
      // edge runtime has no node:fs/node:module — the node drop-in cannot
      // load there, so it stays off (imports fall through to
      // `@scriptcable/client`, whose wasm fallback still applies).
      const isEdge = ctx?.isServer && ctx?.nextRuntime === 'edge';
      const flavor: 'browser' | 'node' | false = !dropinEnabled
        ? false
        : !ctx?.isServer
          ? 'browser'
          : isEdge
            ? false
            : 'node';
      const state = { entryAbs: '', dropinPath: '' };
      const buildPlugin = {
        apply(compiler: any) {
          compiler.hooks.beforeCompile.tapPromise('ScriptcableWebpackPlugin', async () => {
            const out = await runScriptcableBuild(
              compiler.context || process.cwd(),
              configPath,
              dropinEnabled ? flavor : false,
            );
            state.entryAbs = out.entryAbs;
            state.dropinPath = out.dropinPath;
          });
        },
      };
      config.plugins = [...(config.plugins || []), buildPlugin];
      if (dropinEnabled) {
        config.resolve = config.resolve || {};
        config.resolve.plugins = [...(config.resolve.plugins || []), dropinGate(state)];
      }
      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, ctx);
      }
      return config;
    },
  };
}

/**
 * Async variant for Turbopack (`next.config.mjs` supports top-level await):
 * wires everything `withScriptcable` does and additionally emits
 * `turbopack.resolveAlias` so entry imports redirect onto the browser
 * drop-in under `next dev --turbo`. The alias fires only once a build has
 * produced `.scriptcable/generated/dropin/browser.ts`; before that, imports
 * resolve to the source module as usual.
 */
export async function withScriptcableAsync(
  nextConfig: NextConfig = {},
  options: WithScriptcableOptions & { cwd?: string } = {},
): Promise<NextConfig> {
  const base = withScriptcable(nextConfig, options);
  const root = options.cwd ?? process.cwd();
  try {
    const config: ResolvedConfig = options.configPath
      ? await loadConfigFile(resolve(root, options.configPath), root)
      : (await loadProjectConfig(root)).config;
    // Same gates as the webpack path: the entry's surface must be fully
    // mappable, and the drop-in must exist (a missing alias target would
    // surface as an opaque Turbopack resolution error, not a clean skip).
    const { profile } = await resolveProfile(config, root);
    const check = await canInterceptEntry(config, root, profile);
    if (!check.ok) {
      console.warn(`[scriptcable] drop-in (turbopack) disabled — ${check.reasons.join('; ')}`);
      return base;
    }
    const dropinPath = join(resolve(root, config.outDir ?? '.scriptcable'), 'generated', 'dropin', 'browser.ts');
    if (!existsSync(dropinPath)) {
      console.warn('[scriptcable] turbopack.resolveAlias not set — run `scriptcable build` first to emit the drop-in');
      return base;
    }
    const entryAbs = resolve(root, config.entry);
    const existing = nextConfig.turbopack ?? {};
    base.turbopack = {
      ...existing,
      resolveAlias: { ...(existing.resolveAlias ?? {}), [entryAbs]: dropinPath },
    };
  } catch {
    console.warn('[scriptcable] turbopack.resolveAlias not set — could not resolve the core config');
  }
  return base;
}
