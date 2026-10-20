import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectConfig, defineConfig } from './config-loader.js';

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'scfg-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('config-loader', () => {
  it('loads a TS config (relative import inside project) and keeps exports undefined', async () => {
    await withTmpDir(async (dir) => {
      // Simulate a user project: @scriptcable/core resolvable via node_modules
      const nmDir = join(dir, 'node_modules', '@scriptcable');
      await symlink(resolveRepoDir('packages/core'), join(nmDir, 'core'), 'dir').catch(async () => {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(nmDir, { recursive: true });
        await symlink(resolveRepoDir('packages/core'), join(nmDir, 'core'), 'dir');
      });
      await writeFile(
        join(dir, 'scriptcable.config.ts'),
        `import { defineConfig } from '@scriptcable/core';
export default defineConfig({ name: 'demo', entry: 'src/core.ts' });
`,
      );
      const { config, source } = await loadProjectConfig(dir);
      assert.equal(source, 'scriptcable.config.ts');
      assert.equal(config.name, 'demo');
      assert.equal(config.exports, undefined);
    });
  });

  it('falls back to scriptcable.json when no TS config exists', async () => {
    await withTmpDir(async (dir) => {
      await writeFile(
        join(dir, 'scriptcable.json'),
        JSON.stringify({ name: 'j', entry: 'src/core.ts' }),
      );
      const { source } = await loadProjectConfig(dir);
      assert.equal(source, 'scriptcable.json');
    });
  });

  it('TS config takes priority over JSON', async () => {
    await withTmpDir(async (dir) => {
      await writeFile(join(dir, 'scriptcable.json'), JSON.stringify({ name: 'json-one', entry: 'a.ts' }));
      // no node_modules symlink needed: config imports nothing
      await writeFile(
        join(dir, 'scriptcable.config.ts'),
        `export default { name: 'ts-one', entry: 'a.ts' };
`,
      );
      const { config } = await loadProjectConfig(dir);
      assert.equal(config.name, 'ts-one');
    });
  });

  it('errors helpfully when neither config exists', async () => {
    await withTmpDir(async (dir) => {
      await assert.rejects(
        () => loadProjectConfig(dir),
        /scriptcable\.config\.ts/,
      );
    });
  });

  it('defineConfig passes the config through unchanged', () => {
    const cfg = defineConfig({ name: 'x', entry: 'e.ts', exports: [{ name: 'f', params: ['f64'], returns: 'f64' }] });
    assert.equal(cfg.name, 'x');
    assert.equal(cfg.exports!.length, 1);
  });
});

function resolveRepoDir(rel: string): string {
  // tests run from packages/core/src — repo root is three levels up
  const { resolve } = require('node:path') as typeof import('node:path');
  return resolve(import.meta.dir, '../../..', rel);
}
