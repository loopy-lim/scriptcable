import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildCore, loadConfig, snapshotFromConfig } from '@scriptca/core';
import { generateClients } from '@scriptca/core/codegen';
export async function runBuild(opts = {}) {
    const cwd = opts.cwd ?? process.cwd();
    const configPath = resolve(cwd, opts.configPath ?? 'scriptca.json');
    const raw = JSON.parse(await readFile(configPath, 'utf8'));
    const config = loadConfig(raw);
    const outDir = resolve(cwd, config.outDir ?? '.scriptca');
    console.log(`Building ${config.name} (${opts.target ?? config.target ?? 'wasm'})…`);
    const result = await buildCore(config, {
        cwd,
        target: opts.target ?? config.target ?? 'wasm',
        outDir,
    });
    const hosts = opts.hosts ?? ['node', 'bun', 'browser'];
    const wasmName = `${config.name}.wasm`;
    const generated = generateClients(config, hosts, { wasmFileName: wasmName });
    const genDir = join(outDir, 'generated');
    await mkdir(genDir, { recursive: true });
    for (const [name, body] of Object.entries(generated.files)) {
        await writeFile(join(genDir, name), body);
    }
    // Copy wasm next to generated clients for relative imports
    if (result.wasmPath) {
        await copyFile(result.wasmPath, join(genDir, wasmName));
    }
    const snap = snapshotFromConfig(config);
    console.log(`  profile:   ${result.profilePath}`);
    if (result.wasmPath)
        console.log(`  wasm:      ${result.wasmPath}`);
    if (result.nativePath)
        console.log(`  native:    ${result.nativePath}`);
    console.log(`  generated: ${genDir}`);
    console.log(`  contract:  ${snap.hash}`);
    return 0;
}
//# sourceMappingURL=build.js.map