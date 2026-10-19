import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { buildCore, loadConfig, snapshotFromConfig } from '@scriptca/core';
import { generateClients, type CodegenTarget } from '@scriptca/core/codegen';

export type BuildCliOptions = {
  cwd?: string;
  target?: 'wasm' | 'native' | 'both';
  hosts?: CodegenTarget[];
  configPath?: string;
};

export async function runBuild(opts: BuildCliOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const configPath = resolve(cwd, opts.configPath ?? 'scriptca.json');
  const raw = JSON.parse(await readFile(configPath, 'utf8'));
  const config = loadConfig(raw);
  const outDir = resolve(cwd, config.outDir ?? '.scriptca');

  console.log(`Building ${config.name} (${opts.target ?? config.target ?? 'native'})…`);
  const result = await buildCore(config, {
    cwd,
    target: opts.target ?? config.target ?? 'native',
    outDir,
  });

  const hosts = opts.hosts ?? (['node', 'bun', 'browser'] as CodegenTarget[]);
  const wasmName = `${config.name}.wasm`;
  const generated = generateClients(config, hosts, { wasmFileName: wasmName });
  const genDir = join(outDir, 'generated');
  await mkdir(genDir, { recursive: true });
  for (const [name, body] of Object.entries(generated.files)) {
    await writeFile(join(genDir, name), body);
  }

  // Copy artifacts next to generated clients for relative imports
  if (result.sharedPath) {
    await copyFile(result.sharedPath, join(genDir, basename(result.sharedPath)));
  }
  if (result.wasmPath) {
    await copyFile(result.wasmPath, join(genDir, wasmName));
  }

  const snap = snapshotFromConfig(config);
  console.log(`  profile:   ${result.profilePath}`);
  if (result.nativePath) console.log(`  native:    ${result.nativePath}`);
  if (result.sharedPath) console.log(`  shared:    ${result.sharedPath}`);
  if (result.wasmPath) console.log(`  wasm:      ${result.wasmPath}`);
  console.log(`  generated: ${genDir}`);
  console.log(`  contract:  ${snap.hash}`);
  return 0;
}
