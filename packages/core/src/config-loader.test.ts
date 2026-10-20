import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectConfig, resolveProjectConfig, loadConfigFile, defineConfig } from './config-loader.js';

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

  describe('zero-config', () => {
    it('infers name from package.json and entry from src/core.ts when no config exists', async () => {
      await withTmpDir(async (dir) => {
        await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'my-core' }));
        await mkdir(join(dir, 'src'), { recursive: true });
        await writeFile(join(dir, 'src', 'core.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
        const { config, source, inferredFields } = await resolveProjectConfig(dir);
        assert.equal(source, 'inferred');
        assert.equal(config.name, 'my_core');
        assert.equal(config.entry, 'src/core.ts');
        assert.deepEqual(inferredFields.sort(), ['entry', 'name']);
      });
    });

    it('infers a scoped package name to a C-safe slug', async () => {
      await withTmpDir(async (dir) => {
        await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@scope/my-pkg' }));
        await writeFile(join(dir, 'core.ts'), 'export const x = 1;\n');
        const { config } = await resolveProjectConfig(dir);
        assert.equal(config.name, 'scope_my_pkg');
        assert.equal(config.entry, 'core.ts');
      });
    });

    it('falls back to the directory name when package.json is missing', async () => {
      await withTmpDir(async (dir) => {
        const projectDir = join(dir, 'my-app'); // non-C-safe chars → slug
        await mkdir(projectDir, { recursive: true });
        await writeFile(join(projectDir, 'index.ts'), 'export const x = 1;\n');
        const { config, source } = await resolveProjectConfig(projectDir);
        assert.equal(source, 'inferred');
        assert.equal(config.name, 'my_app');
        assert.equal(config.entry, 'index.ts');
      });
    });

    it('fills name/entry omitted from an existing config file (file wins when present)', async () => {
      await withTmpDir(async (dir) => {
        await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'pkg-name' }));
        await mkdir(join(dir, 'src'), { recursive: true });
        await writeFile(join(dir, 'src', 'core.ts'), 'export const x = 1;\n');
        await writeFile(
          join(dir, 'scriptcable.json'),
          JSON.stringify({ name: 'explicit-name' }), // entry omitted, name explicit
        );
        const { config, source, inferredFields } = await resolveProjectConfig(dir);
        assert.equal(source, 'scriptcable.json');
        assert.equal(config.name, 'explicit-name'); // explicit wins
        assert.equal(config.entry, 'src/core.ts'); // inferred
        assert.deepEqual(inferredFields, ['entry']);
      });
    });

    it('lists searched candidates when no config and no standard entry exist', async () => {
      await withTmpDir(async (dir) => {
        await assert.rejects(
          () => resolveProjectConfig(dir),
          (err: Error) => {
            assert.match(err.message, /scriptcable\.config\.ts/);
            assert.match(err.message, /src\/core\.ts/);
            return true;
          },
        );
      });
    });

    it('loadConfigFile reads .ts and .json configs', async () => {
      await withTmpDir(async (dir) => {
        await writeFile(
          join(dir, 'a.config.ts'),
          `export default { name: 'from-ts', entry: 'x.ts' };\n`,
        );
        const tsCfg = await loadConfigFile(join(dir, 'a.config.ts'));
        assert.equal(tsCfg.name, 'from-ts');

        await writeFile(join(dir, 'b.config.json'), JSON.stringify({ name: 'from-json', entry: 'x.ts' }));
        const jsonCfg = await loadConfigFile(join(dir, 'b.config.json'));
        assert.equal(jsonCfg.name, 'from-json');
      });
    });

    it('loadProjectConfig resolves name/entry (back-compat shape)', async () => {
      await withTmpDir(async (dir) => {
        await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'legacy' }));
        await mkdir(join(dir, 'src'), { recursive: true });
        await writeFile(join(dir, 'src', 'core.ts'), 'export const x = 1;\n');
        const { config } = await loadProjectConfig(dir);
        assert.equal(config.name, 'legacy');
        assert.equal(config.entry, 'src/core.ts');
      });
    });
  });
});

function resolveRepoDir(rel: string): string {
  // tests run from packages/core/src — repo root is three levels up
  const { resolve } = require('node:path') as typeof import('node:path');
  return resolve(import.meta.dir, '../../..', rel);
}
