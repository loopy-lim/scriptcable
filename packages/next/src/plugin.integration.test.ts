/**
 * Integration test: the Next.js plugin path ALONE (no `scriptcable build`
 * CLI run, no config file — exports inferred from src/core.ts). Guards the
 * plugin-only failure modes: inferred exports must reach the generated
 * clients, and the native shared library must be loadable through
 * `@scriptcable/client`.
 */
import { describe, it, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile, lstat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scriptcableBuild, withScriptcable, withScriptcableAsync } from './index.js';

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

    // Browser flavor: the wasm artifact is ensured (built here on first use,
    // cached afterwards) and copied into public/ — no manual copy step
    await access(join(project, 'public', 'next_plugin_it.wasm'));
    await access(join(genDir, 'next_plugin_it.wasm'));

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

    // Drop-in flavors are emitted alongside the regular clients
    await access(join(genDir, 'dropin', 'browser.ts'));
    await access(join(genDir, 'dropin', 'node.ts'));
  }, 120_000);

  it('wires a drop-in resolve gate per graph: client → browser, server → node', async () => {
    const project = await makeProject();

    // Run the real build once so both graphs' drop-ins exist on disk.
    await scriptcableBuild({ cwd: project });
    const genDir = join(project, '.scriptcable', 'generated');
    await access(join(genDir, 'dropin', 'browser.ts'));
    await access(join(genDir, 'dropin', 'node.ts'));

    const gates: Record<string, { apply: (resolver: unknown) => void }> = {};
    for (const isServer of [false, true]) {
      const cfg = withScriptcable({});
      const webpackConfig: { plugins: unknown[]; resolve?: { plugins?: unknown[]; extensionAlias?: Record<string, string[]> } } = {
        plugins: [],
      };
      cfg.webpack!(webpackConfig, { isServer });
      const gate = webpackConfig.resolve?.plugins?.[0] as { apply: (resolver: unknown) => void } | undefined;
      assert.ok(gate, `isServer=${isServer} must wire a drop-in gate`);
      // The generated clients import each other via `.js` specifiers — the
      // hook must teach webpack the `.js` → `.ts` mapping (real Next builds
      // fail with "Can't resolve '../node.js'" without it).
      assert.deepEqual(webpackConfig.resolve?.extensionAlias?.['.js'], ['.js', '.ts', '.tsx']);
      gates[isServer ? 'server' : 'client'] = gate;
    }

    // Before the build hook runs, the gate is inert (no resolver tap).
    let tapped = 0;
    const stubResolver = {
      ensureHook: (name: string) => ({ hook: name }),
      getHook: () => ({
        tapAsync: () => {
          tapped += 1;
        },
      }),
      doResolve: () => {},
    };
    gates.client!.apply(stubResolver);
    assert.equal(tapped, 0, 'gate must stay inert until the build proves interceptability');

    // Run the client-graph build hook — the same gate now wires the redirect.
    for (const isServer of [false, true]) {
      const cfg = withScriptcable({});
      const webpackConfig: { plugins: Array<{ apply: (compiler: unknown) => void }>; resolve?: { plugins?: unknown[] } } = {
        plugins: [],
      };
      cfg.webpack!(webpackConfig, { isServer });
      const buildPlugin = webpackConfig.plugins[0]!;
      let hook: (() => Promise<void>) | null = null;
      buildPlugin.apply({
        context: project,
        hooks: { beforeCompile: { tapPromise: (_n: string, fn: () => Promise<void>) => (hook = fn) } },
      });
      await hook!();
      const gate = webpackConfig.resolve?.plugins?.[0] as { apply: (resolver: unknown) => void };
      tapped = 0;
      gate.apply(stubResolver);
      assert.equal(tapped, 1, `isServer=${isServer} gate must wire the redirect after its build`);
    }
  }, 180_000);

  it('withScriptcableAsync does not set a turbopack resolveAlias (absolute-path keys are inert in Turbopack)', async () => {
    const project = await makeProject();
    await scriptcableBuild({ cwd: project });

    const cfg = await withScriptcableAsync({ reactStrictMode: true }, { cwd: project });
    // Verified against Next 16: turbopack.resolveAlias matches request
    // specifiers, so an absolute-path key silently does nothing — setting it
    // would falsely advertise drop-in under Turbopack.
    assert.equal(cfg.turbopack?.resolveAlias, undefined);
    // The rest of the wiring stays: the compiled client package works under
    // Turbopack via export conditions.
    assert.ok(cfg.transpilePackages?.includes('@scriptcable/client'));
    assert.equal(typeof cfg.webpack, 'function');
  }, 120_000);
});
