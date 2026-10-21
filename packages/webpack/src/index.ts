/**
 * @scriptcable/webpack — Webpack / Rspack / Rsbuild plugin.
 *
 * Zero-config: reads scriptcable.config.ts > scriptcable.json > inference
 * (package.json name + standard entry locations) unless `configPath` is set.
 *
 * Drop-in interception (default on): a resolve plugin redirects module
 * imports that resolve to the core entry onto the generated drop-in client,
 * so app code keeps importing `./core` while the bundle runs the compiled
 * library. Choose the flavor with `dropin: 'browser' | 'node'`, disable with
 * `dropin: false`.
 */
import { join, resolve } from 'node:path';
import {
  buildCore,
  loadProjectConfig,
  loadConfigFile,
  writeGeneratedClients,
  ensureWasmArtifact,
  copyWasmToPublicDir,
  canInterceptEntry,
  ScriptcableDropinResolvePlugin,
} from '@scriptcable/core';

export type ScriptcableWebpackOptions = {
  /** Explicit config file (.ts or .json) — default: auto-discover or infer */
  configPath?: string;
  /**
   * Drop-in client flavor for entry-import redirection (default: 'browser').
   * 'browser' initializes WASM with top-level await — right for web bundles
   * (set output environment / target to ES2022+); a server bundle compiled
   * to CommonJS should use 'node' (await-free `createClientSync`) or false.
   */
  dropin?: 'browser' | 'node' | false;
};

export class ScriptcableWebpackPlugin {
  constructor(private options: ScriptcableWebpackOptions = {}) {}

  apply(compiler: {
    context?: string;
    options?: { resolve?: { plugins?: unknown[] } };
    hooks: { beforeCompile: { tapPromise: (name: string, fn: () => Promise<void>) => void } };
  }): void {
    const configPath = this.options.configPath;
    const dropinFlavor = this.options.dropin === undefined ? 'browser' : this.options.dropin;
    compiler.hooks.beforeCompile.tapPromise('ScriptcableWebpackPlugin', async () => {
      const root = compiler.context || process.cwd();
      const config = configPath
        ? await loadConfigFile(resolve(root, configPath), root)
        : (await loadProjectConfig(root)).config;
      const outDir = resolve(root, config.outDir ?? '.scriptcable');
      const result = await buildCore(config, { cwd: root, outDir, target: 'native' });
      // Browser flavor needs the WASM artifact — ensure + copy to public/ so
      // the generated client's root-URL candidate resolves with no manual step.
      const wasmPath = result.wasmPath ?? (await ensureWasmArtifact(config, { cwd: root, outDir }));
      if (wasmPath) {
        const copied = await copyWasmToPublicDir({
          publicDir: join(root, 'public'),
          wasmPath,
          wasmName: `${config.name}.wasm`,
        });
        if (copied === 'written') {
          console.log(`[scriptcable] browser wasm → public/${config.name}.wasm (served at /${config.name}.wasm)`);
        }
      }
      const { genDir, clientLink } = await writeGeneratedClients({
        config,
        targets: ['browser', 'node'],
        outDir,
        cwd: root,
        wasmFileName: `${config.name}.wasm`,
        copy: { sharedPath: result.sharedPath, wasmPath, addonPath: result.addonPath },
        profile: result.profile,
      });
      if (clientLink === 'blocked') {
        console.warn('[scriptcable] could not link node_modules/@scriptcable/client — run `scriptcable doctor`');
      }
      // Drop-in: imports of the entry resolve to the compiled client. Only
      // when the drop-in can provide the entry's whole runtime export surface.
      if (dropinFlavor) {
        const check = await canInterceptEntry(config, root, result.profile);
        if (check.ok) {
          const webpackOptions = (compiler.options ??= {});
          webpackOptions.resolve ??= {};
          const plugins = (webpackOptions.resolve.plugins ??= []);
          if (!plugins.some((p) => p instanceof ScriptcableDropinResolvePlugin)) {
            plugins.push(
              new ScriptcableDropinResolvePlugin(resolve(root, config.entry), join(genDir, 'dropin', `${dropinFlavor}.ts`)),
            );
            console.log(
              `[scriptcable] drop-in: imports of ${config.entry} resolve to the compiled ${dropinFlavor} client`,
            );
          }
        } else {
          console.warn(`[scriptcable] drop-in disabled — ${check.reasons.join('; ')}`);
        }
      }
    });
  }
}

/** Alias for Rspack / Rsbuild (same compiler hooks). */
export const ScriptcableRspackPlugin = ScriptcableWebpackPlugin;
export default ScriptcableWebpackPlugin;
