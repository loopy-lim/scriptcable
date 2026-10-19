/**
 * @scriptca/next — Next.js integration (Webpack & Turbopack-friendly).
 *
 * Turbopack does not support arbitrary Webpack plugins the same way, so we
 * expose:
 * 1. `withScriptca(nextConfig)` — Webpack plugin path for `next build` / `next dev` (webpack).
 * 2. `scriptcaBuild()` — call from `instrumentation.ts` or a prebuild script for Turbopack.
 */
import { resolve, join } from 'node:path';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import type { ScriptcaConfig } from '@scriptca/types';
import { loadConfig, buildCore } from '@scriptca/core';
import { generateClients } from '@scriptca/core/codegen';

export type WithScriptcaOptions = {
  configPath?: string;
};

async function runScriptcaBuild(projectRoot: string, configPath: string): Promise<string> {
  const abs = resolve(projectRoot, configPath);
  const config = loadConfig(JSON.parse(await readFile(abs, 'utf8')));
  const outDir = resolve(projectRoot, config.outDir ?? '.scriptca');
  const result = await buildCore(config, { cwd: projectRoot, outDir, target: 'native' });
  const genDir = join(outDir, 'generated');
  await mkdir(genDir, { recursive: true });
  const files = generateClients(config, ['node', 'browser'], {
    wasmFileName: `${config.name}.wasm`,
  });
  for (const [name, body] of Object.entries(files.files)) {
    await writeFile(join(genDir, name), body);
  }
  if (result.wasmPath) {
    await copyFile(result.wasmPath, join(genDir, `${config.name}.wasm`));
  }
  return genDir;
}

/** Prebuild helper — works with Turbopack (`next dev --turbo`) via npm script. */
export async function scriptcaBuild(
  options: WithScriptcaOptions & { cwd?: string } = {},
): Promise<string> {
  return runScriptcaBuild(options.cwd ?? process.cwd(), options.configPath ?? 'scriptca.json');
}

type NextConfig = Record<string, unknown> & {
  webpack?: (config: any, ctx: any) => any;
};

export function withScriptca(
  nextConfig: NextConfig = {},
  options: WithScriptcaOptions = {},
): NextConfig {
  const configPath = options.configPath ?? 'scriptca.json';
  return {
    ...nextConfig,
    webpack(config: any, ctx: any) {
      const plugin = {
        apply(compiler: any) {
          compiler.hooks.beforeCompile.tapPromise('ScriptcaWebpackPlugin', async () => {
            await runScriptcaBuild(compiler.context || process.cwd(), configPath);
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

export default withScriptca;
