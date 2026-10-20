/**
 * Integration test: the Next.js plugin path ALONE (no `scriptcable build`
 * CLI run, no config file — exports inferred from src/core.ts). Guards the
 * plugin-only failure modes: inferred exports must reach the generated
 * clients, and the native shared library must be loadable through
 * `@scriptcable/client`.
 */
import { describe, it, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scriptcableBuild } from './index.js';

const repoRoot = resolve(import.meta.dir, '../../..'); // packages/next/src → repo root
const tmpRoots: string[] = [];

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sc-next-plugin-'));
  tmpRoots.push(root);
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'next_plugin_it', version: '0.1.0', private: true, type: 'module' }, null, 2),
  );
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'src', 'core.ts'),
    `/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n`,
  );
  const nm = join(root, 'node_modules');
  await mkdir(join(nm, '@scriptcable'), { recursive: true });
  await mkdir(join(nm, '@scriptc'), { recursive: true });
  await mkdir(join(nm, '.bin'), { recursive: true });
  await symlink(resolve(repoRoot, 'packages/core'), join(nm, '@scriptcable', 'core'), 'dir');
  await symlink(resolve(repoRoot, 'packages/types'), join(nm, '@scriptcable', 'types'), 'dir');
  await symlink(resolve(repoRoot, 'node_modules/scriptc'), join(nm, 'scriptc'), 'dir');
  await symlink(resolve(repoRoot, 'node_modules/.bin/scriptc'), join(nm, '.bin', 'scriptc'), 'file');
  await symlink(
    resolve(repoRoot, 'node_modules/@scriptc/runtime-wasm32-wasi'),
    join(nm, '@scriptc', 'runtime-wasm32-wasi'),
    'dir',
  );
  return root;
}

afterAll(async () => {
  await Promise.all(tmpRoots.map((r) => rm(r, { recursive: true, force: true })));
});

describe('next plugin-only build (integration)', () => {
  it('infers exports, copies the native artifact, and serves @scriptcable/client', async () => {
    const project = await makeProject();
    const genDir = await scriptcableBuild({ cwd: project });

    // F-1: exports inferred from TS — methods must exist in the client
    const nodeSrc = await readFile(join(genDir, 'node.ts'), 'utf8');
    assert.match(nodeSrc, /add\(a: number, b: number\): number/);
    assert.doesNotMatch(nodeSrc, /"exports": \[\]/);

    // F-2: the native shared library is copied where the client searches
    // (platform-agnostic: .dylib on macOS, .so on Linux, .dll on Windows)
    const genFiles = await Array.fromAsync(new Bun.Glob('*').scan({ cwd: genDir }));
    const sharedLibs = genFiles.filter((f) => /\.(dylib|so|dll)$/.test(f));
    assert.equal(
      sharedLibs.length,
      1,
      `expected exactly one shared lib in ${genDir}, got: ${sharedLibs.join(', ')}`,
    );

    // Package manifest + node_modules link
    const clientPkg = JSON.parse(await readFile(join(genDir, 'package.json'), 'utf8'));
    assert.equal(clientPkg.name, '@scriptcable/client');
    const linkPath = join(project, 'node_modules', '@scriptcable', 'client');
    assert.equal((await lstat(linkPath)).isSymbolicLink(), true, 'no node_modules link');

    // Bare specifier resolves and calls the real core — the exact flow a
    // Next server component / route handler would use
    const probe = Bun.spawnSync({
      cmd: [
        'bun',
        '-e',
        `const m = await import('@scriptcable/client');
const c = await m.createClient();
console.log(JSON.stringify({ add: c.add(2, 3) }));`,
      ],
      cwd: project,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    assert.equal(probe.exitCode, 0, `client import failed: ${String(probe.stderr)}`);
    assert.equal(JSON.parse(String(probe.stdout)).add, 5);
  }, 120_000);
});
