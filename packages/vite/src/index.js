/**
 * @scriptca/vite — Vite plugin: builds scriptc core (WASM) on startup and HMR.
 */
import { resolve, join, dirname } from 'node:path';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { loadConfig, buildCore } from '@scriptca/core';
import { generateClients } from '@scriptca/core/codegen';
async function rebuild(root, configPath) {
    const abs = resolve(root, configPath);
    const config = loadConfig(JSON.parse(await readFile(abs, 'utf8')));
    const outDir = resolve(root, config.outDir ?? '.scriptca');
    const result = await buildCore(config, { cwd: root, outDir, target: 'wasm' });
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
export function scriptca(options = {}) {
    const configPath = options.configPath ?? 'scriptca.json';
    const virtualId = options.virtualId ?? 'virtual:scriptca';
    const resolvedVirtual = '\0' + virtualId;
    let root = process.cwd();
    let genDir = '';
    return {
        name: 'vite-plugin-scriptca',
        configResolved(config) {
            root = config.root;
        },
        async buildStart() {
            const r = await rebuild(root, configPath);
            genDir = r.genDir;
        },
        resolveId(id) {
            if (id === virtualId || id === '@scriptca/client')
                return resolvedVirtual;
            return null;
        },
        async load(id) {
            if (id !== resolvedVirtual)
                return null;
            if (!genDir) {
                const r = await rebuild(root, configPath);
                genDir = r.genDir;
            }
            // Re-export browser client
            return `export { createClient, PROFILE } from ${JSON.stringify(join(genDir, 'browser.ts'))};\nexport type { ScriptcaClient } from ${JSON.stringify(join(genDir, 'types.ts'))};\n`;
        },
        async handleHotUpdate(ctx) {
            if (ctx.file.includes('scriptca.json') || /\.(ts|js)$/.test(ctx.file)) {
                // Only rebuild when core entry or config changes
                try {
                    const raw = JSON.parse(await readFile(resolve(root, configPath), 'utf8'));
                    const entryAbs = resolve(root, dirname(configPath), raw.entry);
                    if (ctx.file === resolve(root, configPath) || ctx.file === entryAbs) {
                        await rebuild(root, configPath);
                        ctx.server.ws.send({ type: 'full-reload' });
                    }
                }
                catch {
                    /* ignore */
                }
            }
        },
    };
}
export default scriptca;
//# sourceMappingURL=index.js.map