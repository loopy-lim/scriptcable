import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readlink, lstat, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  clientPackageManifest,
  writeClientPackage,
  ensureClientPackageLink,
  writeGeneratedClients,
  copyWasmToPublicDir,
} from './client-package.js';
import type { ResolvedConfig, ScriptcableProfile } from '@scriptcable/types';

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'scli-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ALL_TARGETS = ['node', 'bun', 'browser'] as const;

const MINIMAL_CONFIG: ResolvedConfig = {
  name: 'demo',
  entry: 'src/core.ts',
} as ResolvedConfig;

const MINIMAL_PROFILE: ScriptcableProfile = {
  profile_format: 1,
  name: 'demo',
  entry: 'src/core.ts',
  emission: 'llvm',
  abi: {
    prefix: 'demo_',
    init_symbol: 'demo_init',
    sink_register_symbol: 'demo_sink',
  },
  exports: [
    { export: 'add', symbol: 'demo_add', params: ['f64', 'f64'], returns: 'f64' },
  ],
};

describe('clientPackageManifest', () => {
  it('maps runtime flavors first and defaults to browser for condition-less resolvers', () => {
    const m = clientPackageManifest([...ALL_TARGETS]);
    const dot = (m.exports as Record<string, unknown>)['.'] as Record<string, string>;
    // Runtime flavors point at compiled .js — Electron's Node 20 and any
    // pre-type-strip Node can't import .ts; Bun/Node 24 run the same output.
    assert.equal(dot.bun, './bun.js');
    assert.equal(dot.node, './node.js');
    assert.equal(dot.browser, './browser.ts');
    assert.equal(dot.default, './browser.ts');
    const exports = m.exports as Record<string, unknown>;
    assert.equal(exports['./node'], './node.js');
    assert.equal(exports['./bun'], './bun.js');
    assert.equal(exports['./browser'], './browser.ts');
    assert.equal(exports['./*'], './*.ts');
    assert.equal((m as { name: string }).name, '@scriptcable/client');
  });

  it('with a single flavor, dot resolves to it and only that subpath exists', () => {
    const m = clientPackageManifest(['react-native']);
    const dot = (m.exports as Record<string, unknown>)['.'] as Record<string, string>;
    assert.equal(dot['react-native'], './react-native.ts');
    assert.equal(dot.default, './react-native.ts');
    assert.equal(dot.browser, undefined);
    const exports = m.exports as Record<string, unknown>;
    assert.equal(exports['./react-native'], './react-native.ts');
    assert.equal(exports['./browser'], undefined);
  });

  it('deno ships as .js ahead of node; workerd resolves ahead of browser', () => {
    const m = clientPackageManifest(['bun', 'deno', 'node', 'workers', 'browser']);
    const dot = (m.exports as Record<string, unknown>)['.'] as Record<string, string>;
    // Deno won't strip types under node_modules — the flavor must be .js.
    assert.equal(dot.deno, './deno.js');
    assert.equal(dot.node, './node.js');
    // Bundler-resolved: wrangler's esbuild handles the TS.
    assert.equal(dot.workerd, './workers.ts');
    const keys = Object.keys(dot);
    assert.ok(keys.indexOf('deno') < keys.indexOf('node'), 'deno must precede node (Deno enables the node condition itself)');
    assert.ok(keys.indexOf('workerd') < keys.indexOf('browser'), 'workerd must precede browser (wrangler resolves with both on)');
    const exports = m.exports as Record<string, unknown>;
    assert.equal(exports['./deno'], './deno.js');
    assert.equal(exports['./workerd'], './workers.ts');
  });
});

describe('writeClientPackage', () => {
  it('writes the manifest and skips identical rewrites', async () => {
    await withTmpDir(async (dir) => {
      const genDir = join(dir, 'generated');
      await mkdir(genDir, { recursive: true });
      assert.equal(await writeClientPackage(genDir, [...ALL_TARGETS]), true);
      const body = await readFile(join(genDir, 'package.json'), 'utf8');
      assert.equal(await writeClientPackage(genDir, [...ALL_TARGETS]), false);
      assert.equal(await readFile(join(genDir, 'package.json'), 'utf8'), body);
    });
  });
});

describe('ensureClientPackageLink', () => {
  it('creates node_modules link when missing, and is idempotent', async () => {
    await withTmpDir(async (dir) => {
      const genDir = join(dir, '.scriptcable', 'generated');
      await mkdir(genDir, { recursive: true });
      assert.equal(await ensureClientPackageLink(dir, genDir), 'linked');
      const linkPath = join(dir, 'node_modules', '@scriptcable', 'client');
      assert.equal((await lstat(linkPath)).isSymbolicLink(), true);
      assert.equal(resolve(dirname(linkPath), await readlink(linkPath)), resolve(genDir));
      assert.equal(await ensureClientPackageLink(dir, genDir), 'current');
    });
  });

  it('repairs a dangling symlink', async () => {
    await withTmpDir(async (dir) => {
      const genDir = join(dir, '.scriptcable', 'generated');
      await mkdir(genDir, { recursive: true });
      const linkDir = join(dir, 'node_modules', '@scriptcable');
      await mkdir(linkDir, { recursive: true });
      await symlink(join(dir, 'gone'), join(linkDir, 'client'), 'dir');
      assert.equal(await ensureClientPackageLink(dir, genDir), 'repaired');
      assert.equal(resolve(dirname(join(linkDir, 'client')), await readlink(join(linkDir, 'client'))), resolve(genDir));
    });
  });

  it('leaves a real directory at the link path alone', async () => {
    await withTmpDir(async (dir) => {
      const genDir = join(dir, '.scriptcable', 'generated');
      await mkdir(genDir, { recursive: true });
      const real = join(dir, 'node_modules', '@scriptcable', 'client');
      await mkdir(real, { recursive: true });
      await writeFile(join(real, 'keep.txt'), 'mine');
      assert.equal(await ensureClientPackageLink(dir, genDir), 'blocked');
      assert.equal(await readFile(join(real, 'keep.txt'), 'utf8'), 'mine');
    });
  });

  it('replaces a bun-managed file: dep copy (pre-build placeholder shadowing)', async () => {
    await withTmpDir(async (dir) => {
      const genDir = join(dir, '.scriptcable', 'generated');
      await mkdir(genDir, { recursive: true });
      // The scaffold declares the dep before the first build — bun then
      // materializes a real copied dir (here: the placeholder manifest).
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'demo',
          dependencies: { '@scriptcable/client': 'file:.scriptcable/generated' },
        }),
      );
      const managed = join(dir, 'node_modules', '@scriptcable', 'client');
      await mkdir(managed, { recursive: true });
      await writeFile(
        join(managed, 'package.json'),
        JSON.stringify({ name: '@scriptcable/client', exports: { '.': './placeholder.ts' } }),
      );
      await writeFile(join(managed, 'placeholder.ts'), 'export const stub = true;\n');
      assert.equal(await ensureClientPackageLink(dir, genDir), 'repaired');
      const linkPath = join(dir, 'node_modules', '@scriptcable', 'client');
      assert.equal((await lstat(linkPath)).isSymbolicLink(), true);
      assert.equal(resolve(dirname(linkPath), await readlink(linkPath)), resolve(genDir));
    });
  });

  it('still leaves a real directory alone when no file: dep declares it', async () => {
    await withTmpDir(async (dir) => {
      const genDir = join(dir, '.scriptcable', 'generated');
      await mkdir(genDir, { recursive: true });
      // Dep declared but pointing elsewhere — not this project's managed copy.
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'demo',
          dependencies: { '@scriptcable/client': 'file:../other/generated' },
        }),
      );
      const real = join(dir, 'node_modules', '@scriptcable', 'client');
      await mkdir(real, { recursive: true });
      await writeFile(join(real, 'keep.txt'), 'mine');
      assert.equal(await ensureClientPackageLink(dir, genDir), 'blocked');
      assert.equal(await readFile(join(real, 'keep.txt'), 'utf8'), 'mine');
    });
  });

  it('is blocked when nothing was generated yet', async () => {
    await withTmpDir(async (dir) => {
      assert.equal(await ensureClientPackageLink(dir, join(dir, 'missing')), 'blocked');
    });
  });
});

describe('writeGeneratedClients', () => {
  it('emits flavors, package.json, and the link in one call', async () => {
    await withTmpDir(async (dir) => {
      const { genDir, clientLink } = await writeGeneratedClients({
        config: MINIMAL_CONFIG,
        targets: [...ALL_TARGETS],
        outDir: join(dir, '.scriptcable'),
        cwd: dir,
        profile: MINIMAL_PROFILE,
      });
      for (const f of ['types.ts', 'index.ts', 'node.ts', 'bun.ts', 'browser.ts', 'package.json']) {
        assert.equal(await readFile(join(genDir, f), 'utf8').then(Boolean), true, f);
      }
      // Compiled .js siblings for the runtime flavors — the manifest's
      // node/bun conditions point at these (Electron's Node can't load .ts).
      const nodeJs = await readFile(join(genDir, 'node.js'), 'utf8');
      assert.doesNotMatch(nodeJs, /:\s*(number|string|boolean)\b|import type/, 'types stripped');
      assert.match(nodeJs, /export function createClient|export const createClient/);
      assert.equal(await readFile(join(genDir, 'bun.js'), 'utf8').then(Boolean), true, 'bun.js');
      assert.equal(join(dir, '.scriptcable', 'generated'), genDir);
      assert.equal(clientLink, 'linked');
      // node client carries the project-relative fallback dir
      const nodeSrc = await readFile(join(genDir, 'node.ts'), 'utf8');
      assert.match(nodeSrc, /\.scriptcable\/generated/);
      assert.match(nodeSrc, /firstExisting/);
      // browser client defaults WASI away
      const browserSrc = await readFile(join(genDir, 'browser.ts'), 'utf8');
      assert.match(browserSrc, /wasi\?:/);
      assert.match(browserSrc, /createMinimalWasi/);
    });
  });
});

describe('copyWasmToPublicDir', () => {
  it('writes once, then skips identical copies', async () => {
    await withTmpDir(async (dir) => {
      const publicDir = join(dir, 'public');
      const wasmPath = join(dir, 'calc.wasm');
      const bytes = new Uint8Array([0, 97, 115, 109, 1, 2, 3]);
      await writeFile(wasmPath, bytes);

      const first = await copyWasmToPublicDir({ publicDir, wasmPath, wasmName: 'calc.wasm' });
      assert.equal(first, 'written');
      const copied = await readFile(join(publicDir, 'calc.wasm'));
      assert.deepEqual(new Uint8Array(copied), bytes);

      const second = await copyWasmToPublicDir({ publicDir, wasmPath, wasmName: 'calc.wasm' });
      assert.equal(second, 'unchanged');

      // A rebuilt wasm is copied again
      await writeFile(wasmPath, new Uint8Array([9, 9, 9, 9]));
      const third = await copyWasmToPublicDir({ publicDir, wasmPath, wasmName: 'calc.wasm' });
      assert.equal(third, 'written');
      assert.equal((await readFile(join(publicDir, 'calc.wasm'))).byteLength, 4);
    });
  });

  it('skips (never throws) when the source or destination is unwritable', async () => {
    await withTmpDir(async (dir) => {
      const missing = await copyWasmToPublicDir({
        publicDir: join(dir, 'public'),
        wasmPath: join(dir, 'nope.wasm'),
      });
      assert.equal(missing, 'skipped');
      // A file where the public dir belongs — copyFile fails, result is 'skipped'
      await writeFile(join(dir, 'blocker'), 'x');
      const blocked = await copyWasmToPublicDir({
        publicDir: join(dir, 'blocker'),
        wasmPath: join(dir, 'blocker'),
      });
      assert.equal(blocked, 'skipped');
    });
  });
});
