/**
 * Plugin-level test: the webpack hook alone (no CLI, no config file —
 * exports inferred from src/core.ts). Guards the beforeCompile → build →
 * emit flow, the automatic browser-wasm public/ copy, and the drop-in
 * resolve plugin — including a real runtime call through createClientSync.
 */
import { describe, it, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ScriptcableWebpackPlugin } from './index.js';
import { ScriptcableDropinResolvePlugin } from '@scriptcable/core';

const repoRoot = resolve(import.meta.dir, '../../..'); // packages/webpack/src → repo root
const tmpRoots: string[] = [];

afterAll(async () => {
  await Promise.all(tmpRoots.map((r) => rm(r, { recursive: true, force: true })));
});

async function makeProject(coreSource?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sc-webpack-plugin-'));
  tmpRoots.push(root);
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'webpack_plugin_it', version: '0.1.0', private: true, type: 'module' }, null, 2),
  );
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'src', 'core.ts'),
    coreSource ?? `/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n`,
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

function runHook(root: string, options: ConstructorParameters<typeof ScriptcableWebpackPlugin>[0] = {}) {
  const plugin = new ScriptcableWebpackPlugin(options);
  const compilerOptions: { resolve?: { plugins?: unknown[] } } = {};
  let hook: (() => Promise<void>) | null = null;
  plugin.apply({
    context: root,
    options: compilerOptions,
    hooks: {
      beforeCompile: {
        tapPromise: (_name: string, fn: () => Promise<void>) => {
          hook = fn;
        },
      },
    },
  });
  assert.ok(hook, 'plugin never tapped beforeCompile');
  return {
    run: hook!,
    resolvePlugins: () => compilerOptions.resolve?.plugins ?? [],
  };
}

describe('webpack plugin-only build', () => {
  it('builds via beforeCompile, emits clients, and copies the browser wasm to public/', async () => {
    const root = await makeProject();
    const { run } = runHook(root);
    await run();

    const genDir = join(root, '.scriptcable', 'generated');
    const nodeSrc = await readFile(join(genDir, 'node.ts'), 'utf8');
    assert.match(nodeSrc, /add\(a: number, b: number\): number/);
    const clientPkg = JSON.parse(await readFile(join(genDir, 'package.json'), 'utf8'));
    assert.equal(clientPkg.name, '@scriptcable/client');

    // Browser wasm ensured + copied to public/ — no manual step
    await access(join(root, 'public', 'webpack_plugin_it.wasm'));
    await access(join(genDir, 'webpack_plugin_it.wasm'));
  }, 180_000);

  it('drops in: resolve plugin redirects entry imports, and createClientSync really calls', async () => {
    const root = await makeProject();
    const { run, resolvePlugins } = runHook(root);
    await run();

    const genDir = join(root, '.scriptcable', 'generated');
    await access(join(genDir, 'dropin', 'browser.ts'));
    await access(join(genDir, 'dropin', 'node.ts'));

    const plugins = resolvePlugins();
    assert.equal(plugins.length, 1, 'exactly one drop-in resolve plugin');
    assert.ok(plugins[0] instanceof ScriptcableDropinResolvePlugin);

    // Rebuild (cache hit) must not push a second resolve plugin
    await run();
    assert.equal(resolvePlugins().length, 1, 'rebuild must not duplicate the resolve plugin');

    // The drop-in promise, end to end: the generated node client loads the
    // native addon synchronously and the call runs at compiled speed.
    const mod = await import(pathToFileURL(join(genDir, 'node.ts')).href);
    const client = mod.createClientSync();
    assert.equal(client.add(20, 22), 42);
    const dropin = await import(pathToFileURL(join(genDir, 'dropin', 'node.ts')).href);
    assert.equal(dropin.add(20, 22), 42, 'drop-in named export must call the compiled core');
    assert.equal(dropin.getScriptcableClient(), dropin.getScriptcableClient(), 'module-scope singleton');
    assert.equal(dropin.getScriptcableClient().add(3, 4), 7);
  }, 180_000);

  it('skips interception when the entry has an unmappable runtime export', async () => {
    const root = await makeProject(
      `/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n` +
        `export const LIMIT = 10;\n`,
    );
    const { run, resolvePlugins } = runHook(root);
    await run();
    assert.deepEqual(resolvePlugins(), [], 'unmappable export must disable the drop-in');
    // The build itself still succeeded — correctness over speed, with a warning
    await access(join(root, '.scriptcable', 'generated', 'node.ts'));
  }, 180_000);

  it('dropin:false opts out entirely', async () => {
    const root = await makeProject();
    const { run, resolvePlugins } = runHook(root, { dropin: false });
    await run();
    assert.deepEqual(resolvePlugins(), []);
    await access(join(root, '.scriptcable', 'generated', 'dropin', 'browser.ts'));
  }, 180_000);
});
