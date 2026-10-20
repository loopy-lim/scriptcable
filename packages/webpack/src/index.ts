/**
 * @scriptcable/webpack — Webpack / Rspack / Rsbuild plugin.
 */
import { resolve, join } from 'node:path';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { loadConfig, buildCore } from '@scriptcable/core';
import { generateClients } from '@scriptcable/core/codegen';

export type ScriptcaWebpackOptions = {
  configPath?: string;
};

export class ScriptcaWebpackPlugin {
  constructor(private options: ScriptcaWebpackOptions = {}) {}

  apply(compiler: {
    context?: string;
    hooks: { beforeCompile: { tapPromise: (name: string, fn: () => Promise<void>) => void } };
  }): void {
    const configPath = this.options.configPath ?? 'scriptcable.json';
    compiler.hooks.beforeCompile.tapPromise('ScriptcaWebpackPlugin', async () => {
      const root = compiler.context || process.cwd();
      const abs = resolve(root, configPath);
      const config = loadConfig(JSON.parse(await readFile(abs, 'utf8')));
      const outDir = resolve(root, config.outDir ?? '.scriptcable');
      const result = await buildCore(config, { cwd: root, outDir, target: 'native' });
      const genDir = join(outDir, 'generated');
      await mkdir(genDir, { recursive: true });
      const files = generateClients(config, ['browser', 'node'], {
        wasmFileName: `${config.name}.wasm`,
      });
      for (const [name, body] of Object.entries(files.files)) {
        await writeFile(join(genDir, name), body);
      }
      if (result.wasmPath) {
        await copyFile(result.wasmPath, join(genDir, `${config.name}.wasm`));
      }
    });
  }
}

/** Alias for Rspack / Rsbuild (same compiler hooks). */
export const ScriptcaRspackPlugin = ScriptcaWebpackPlugin;
export default ScriptcaWebpackPlugin;
