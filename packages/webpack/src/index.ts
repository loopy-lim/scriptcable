/**
 * @scriptcable/webpack — Webpack / Rspack / Rsbuild plugin.
 *
 * Zero-config: reads scriptcable.config.ts > scriptcable.json > inference
 * (package.json name + standard entry locations) unless `configPath` is set.
 */
import { resolve } from 'node:path';
import { buildCore, loadProjectConfig, loadConfigFile, writeGeneratedClients } from '@scriptcable/core';

export type ScriptcableWebpackOptions = {
  /** Explicit config file (.ts or .json) — default: auto-discover or infer */
  configPath?: string;
};

export class ScriptcableWebpackPlugin {
  constructor(private options: ScriptcableWebpackOptions = {}) {}

  apply(compiler: {
    context?: string;
    hooks: { beforeCompile: { tapPromise: (name: string, fn: () => Promise<void>) => void } };
  }): void {
    const configPath = this.options.configPath;
    compiler.hooks.beforeCompile.tapPromise('ScriptcableWebpackPlugin', async () => {
      const root = compiler.context || process.cwd();
      const config = configPath
        ? await loadConfigFile(resolve(root, configPath), root)
        : (await loadProjectConfig(root)).config;
      const outDir = resolve(root, config.outDir ?? '.scriptcable');
      const result = await buildCore(config, { cwd: root, outDir, target: 'native' });
      const { clientLink } = await writeGeneratedClients({
        config,
        targets: ['browser', 'node'],
        outDir,
        cwd: root,
        wasmFileName: `${config.name}.wasm`,
        copy: { sharedPath: result.sharedPath, wasmPath: result.wasmPath },
        profile: result.profile,
      });
      if (clientLink === 'blocked') {
        console.warn('[scriptcable] could not link node_modules/@scriptcable/client — run `scriptcable doctor`');
      }
    });
  }
}

/** Alias for Rspack / Rsbuild (same compiler hooks). */
export const ScriptcableRspackPlugin = ScriptcableWebpackPlugin;
export default ScriptcableWebpackPlugin;
