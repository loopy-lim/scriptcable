/**
 * Integration test: zero-config build. Creates a real project with NO
 * scriptcable config file and runs the full `scriptcable build` pipeline
 * (scriptc compile + native link + codegen) against the workspace dist.
 */
import { describe, it, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, lstat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runBuild } from './commands/build.js';

const repoRoot = resolve(import.meta.dir, '../../..'); // packages/cli/src → repo root
const tmpRoots: string[] = [];

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sc-zero-cfg-'));
  tmpRoots.push(root);
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'zero-cfg-it', version: '0.1.0', private: true, type: 'module' }, null, 2),
  );
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'src', 'core.ts'),
    [
      `/** Adds two numbers. */`,
      `export function add(a: number, b: number): number {`,
      `  return a + b;`,
      `}`,
      ``,
      `/** Doubles a 64-bit signed integer. */`,
      `export function twice(n: bigint): bigint {`,
      `  return n + n;`,
      `}`,
      ``,
      `/** Signals whether the value is greater than zero. */`,
      `export function isPositive(x: number): boolean {`,
      `  return x > 0;`,
      `}`,
      ``,
      `/** Greets by name — string param and string return through (ptr,len). */`,
      `export function greet(name: string): string {`,
      `  return 'hello, ' + name;`,
      `}`,
      ``,
      `/** Echoes bytes back — (ptr,len) in, (out_ptr,out_len) out. Custom param name on purpose. */`,
      `export function echo(payload: Uint8Array): Uint8Array {`,
      `  return payload;`,
      `}`,
    ].join('\n') + '\n',
  );
  // Make the workspace resolvable from the temp project
  const nm = join(root, 'node_modules');
  await mkdir(join(nm, '@scriptcable'), { recursive: true });
  await mkdir(join(nm, '@scriptc'), { recursive: true });
  await mkdir(join(nm, '.bin'), { recursive: true });
  await symlink(resolve(repoRoot, 'packages/core'), join(nm, '@scriptcable', 'core'), 'dir');
  await symlink(resolve(repoRoot, 'packages/types'), join(nm, '@scriptcable', 'types'), 'dir');
  await symlink(resolve(repoRoot, 'node_modules/scriptc'), join(nm, 'scriptc'), 'dir');
  await symlink(
    resolve(repoRoot, 'node_modules/.bin/scriptc'),
    join(nm, '.bin', 'scriptc'),
    'file',
  );
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

describe('zero-config build (integration)', () => {
  it('builds a native core with no scriptcable config file', async () => {
    const project = await makeProject();
    const code = await runBuild({ cwd: project });
    assert.equal(code, 0);

    const profile = JSON.parse(await Bun.file(join(project, '.scriptcable', 'profile.json')).text());
    assert.equal(profile.name, 'zero_cfg_it'); // inferred from package.json
    // twice(bigint) is skipped at inference (not ABI-mappable) → 4 exports
    assert.equal(profile.exports.length, 4);
    assert.equal(profile.exports[0].export, 'add');
    // native artifact + generated client exist
    const artifacts = await Array.fromAsync(new Bun.Glob('.scriptcable/*').scan({ cwd: project }));
    assert.ok(
      artifacts.some((a) => a.endsWith('.dylib') || a.endsWith('.so') || a.endsWith('.dll')),
      `no shared lib in ${artifacts.join(', ')}`,
    );
    const generated = await Array.fromAsync(new Bun.Glob('.scriptcable/generated/*.ts').scan({ cwd: project }));
    assert.ok(generated.some((g) => g.endsWith('node.ts')), `no generated client in ${generated.join(', ')}`);

    // @scriptcable/client package: manifest written, link present
    const clientPkg = JSON.parse(await Bun.file(join(project, '.scriptcable', 'generated', 'package.json')).text());
    assert.equal(clientPkg.name, '@scriptcable/client');
    const linkPath = join(project, 'node_modules', '@scriptcable', 'client');
    assert.equal((await lstat(linkPath)).isSymbolicLink(), true, 'no node_modules/@scriptcable/client link');

    // Typed N-API direct binding: built into outDir and copied next to the clients
    const addonPath = join(project, '.scriptcable', 'zero_cfg_it.node');
    await access(addonPath);
    await access(join(project, '.scriptcable', 'generated', 'zero_cfg_it.node'));

    // The bare specifier actually resolves and calls the real core under Bun,
    // exercising the typed addon across all ABI classes
    const probe = Bun.spawnSync({
      cmd: [
        'bun',
        '-e',
        `const m = await import('@scriptcable/client');
const c = await m.createClient();
console.log(JSON.stringify({
  add: c.add(20, 22),
  flag: c.isPositive(3),
  greet: c.greet('direct'),
  bytes: Array.from(c.echo(new Uint8Array([1, 2, 3]))),
}));`,
      ],
      cwd: project,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    assert.equal(probe.exitCode, 0, `client import failed: ${String(probe.stderr)}`);
    const out = JSON.parse(String(probe.stdout));
    assert.equal(out.add, 42);
    assert.equal(out.flag, true, 'bool return must be true, not 1');
    assert.equal(out.greet, 'hello, direct', 'string param+return must survive the addon path (double-free guard)');
    assert.deepEqual(out.bytes, [1, 2, 3], 'bytes round-trip through (ptr,len) ABI with a custom param name');
  }, 120_000);
});
