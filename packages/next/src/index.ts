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
 */
import { resolve } from 'node:path';
import type { ResolvedConfig } from '@scriptcable/types';
import { buildCore, loadProjectConfig, loadConfigFile, writeGeneratedClients } from '@scriptcable/core';

export type WithScriptcableOptions = {
  /** Explicit config file (.ts or .json) — default: auto-discover or infer */
  configPath?: string;
};

async function runScriptcableBuild(projectRoot: string, configPath?: string): Promise<string> {
  const config = configPath
    ? await loadConfigFile(resolve(projectRoot, configPath), projectRoot)
    : (await loadProjectConfig(projectRoot)).config;
  const outDir = resolve(projectRoot, config.outDir ?? '.scriptcable');
  const result = await buildCore(config, { cwd: projectRoot, outDir, target: 'native' });
  const { genDir, clientLink } = await writeGeneratedClients({
    config,
    targets: ['node', 'browser'],
    outDir,
    cwd: projectRoot,
    wasmFileName: `${config.name}.wasm`,
    copy: { sharedPath: result.sharedPath, wasmPath: result.wasmPath, addonPath: result.addonPath },
    profile: result.profile,
  });
  if (clientLink === 'blocked') {
    console.warn('[scriptcable] could not link node_modules/@scriptcable/client — run `scriptcable doctor`');
  }
  return genDir;
}

/** Prebuild helper — works with Turbopack (`next dev --turbo`) via npm script. */
export async function scriptcableBuild(
  options: WithScriptcableOptions & { cwd?: string } = {},
): Promise<string> {
  return runScriptcableBuild(options.cwd ?? process.cwd(), options.configPath);
}

type NextConfig = Record<string, unknown> & {
  webpack?: (config: any, ctx: any) => any;
  transpilePackages?: string[];
};

export function withScriptcable(
  nextConfig: NextConfig = {},
  options: WithScriptcableOptions = {},
): NextConfig {
  const configPath = options.configPath;
  return {
    ...nextConfig,
    // The generated client package ships plain .ts — both webpack and
    // Turbopack need it transpiled. Honors packages the app already lists.
    transpilePackages: [...new Set([...(nextConfig.transpilePackages ?? []), '@scriptcable/client'])],
    webpack(config: any, ctx: any) {
      const plugin = {
        apply(compiler: any) {
          compiler.hooks.beforeCompile.tapPromise('ScriptcableWebpackPlugin', async () => {
            await runScriptcableBuild(compiler.context || process.cwd(), configPath);
          });
        },
      };
      config.plugins = [...(config.plugins || []), plugin];
      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, ctx);
      }
      return config;
    },
  };
}

export default withScriptcable;
