/**
 * @scriptcable/vite — Vite plugin: builds scriptc core (WASM) on startup and HMR.
 */
import { resolve, join, dirname } from 'node:path';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import type { ScriptcaConfig } from '@scriptcable/types';
import { loadConfig, buildCore, configToProfile } from '@scriptcable/core';
import { generateClients } from '@scriptcable/core/codegen';

export type ScriptcaViteOptions = {
  /** Path to scriptcable.json (default: project root) */
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

async function rebuild(root: string, configPath: string): Promise<{ genDir: string; config: ScriptcaConfig }> {
  const abs = resolve(root, configPath);
  const config = loadConfig(JSON.parse(await readFile(abs, 'utf8')));
  const outDir = resolve(root, config.outDir ?? '.scriptcable');
  const result = await buildCore(config, { cwd: root, outDir, target: config.target === 'wasm' ? 'wasm' : 'both' });
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
  return { genDir, config };
}

export function scriptcable(options: ScriptcaViteOptions = {}): VitePlugin {
  const configPath = options.configPath ?? 'scriptcable.json';
  const virtualId = options.virtualId ?? 'virtual:scriptcable';
  const resolvedVirtual = '\0' + virtualId;
  let root = process.cwd();
  let genDir = '';

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
      if (id === virtualId || id === '@scriptcable/client') return resolvedVirtual;
      return null;
    },
    async load(id) {
      if (id !== resolvedVirtual) return null;
      if (!genDir) {
        const r = await rebuild(root, configPath);
        genDir = r.genDir;
      }
      // Re-export browser client
      return `export { createClient, PROFILE } from ${JSON.stringify(join(genDir, 'browser.ts'))};\nexport type { ScriptcaClient } from ${JSON.stringify(join(genDir, 'types.ts'))};\n`;
    },
    async handleHotUpdate(ctx) {
      if (ctx.file.includes('scriptcable.json') || /\.(ts|js)$/.test(ctx.file)) {
        // Only rebuild when core entry or config changes
        try {
          const raw = JSON.parse(await readFile(resolve(root, configPath), 'utf8')) as ScriptcaConfig;
          const entryAbs = resolve(root, dirname(configPath), raw.entry);
          if (ctx.file === resolve(root, configPath) || ctx.file === entryAbs) {
            await rebuild(root, configPath);
            ctx.server.ws.send({ type: 'full-reload' });
          }
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export default scriptcable;
