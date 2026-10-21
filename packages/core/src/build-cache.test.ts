import { describe, it, beforeAll, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeBuildHash,
  isCachedBuild,
  markBuildDone,
  collectSourceGraph,
} from './build-cache.js';
import type { ScriptcableConfig, ScriptcableProfile } from '@scriptcable/types';

let workDir: string;

const config: ScriptcableConfig = {
  name: 'cachetest',
  entry: 'src/core.ts',
  prefix: 'cachetest_',
  exports: [{ name: 'add', params: ['f64', 'f64'], returns: 'f64' }],
};

const profile: ScriptcableProfile = {
  profile_format: 1,
  name: 'cachetest',
  entry: 'src/core.ts',
  emission: 'llvm',
  abi: { prefix: 'cachetest_', init_symbol: 'cachetest_init', sink_register_symbol: 'cachetest_sink' },
  exports: [{ export: 'add', symbol: 'cachetest_add', params: ['f64', 'f64'], returns: 'f64' }],
};

describe('build cache', () => {
  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'scriptcable-cache-'));
    await mkdir(join(workDir, 'src'), { recursive: true });
    await writeFile(join(workDir, 'src/core.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('hash is stable for identical inputs', async () => {
    const h1 = await computeBuildHash({ cwd: workDir, config, profile, target: 'native' });
    const h2 = await computeBuildHash({ cwd: workDir, config, profile, target: 'native' });
    assert.equal(h1, h2);
  });

  it('tracks the import graph: a nested import invalidates, an unimported sibling does not', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scriptcable-graph-'));
    try {
      await mkdir(join(root, 'src', 'nested'), { recursive: true });
      await writeFile(
        join(root, 'src', 'core.ts'),
        `import { helper } from './nested/helper.js';\nexport function add(a: number, b: number) { return a + helper(b); }\n`,
      );
      await writeFile(join(root, 'src', 'nested', 'helper.ts'), `export function helper(n: number) { return n; }\n`);
      await writeFile(join(root, 'src', 'nested', 'unrelated.ts'), `export const x = 1;\n`);
      const cfg = { ...config, entry: 'src/core.ts' };
      const h1 = await computeBuildHash({ cwd: root, config: cfg, profile, target: 'native' });

      // A change in the IMPORTED nested file must change the hash…
      await writeFile(join(root, 'src', 'nested', 'helper.ts'), `export function helper(n: number) { return n + 1; }\n`);
      const h2 = await computeBuildHash({ cwd: root, config: cfg, profile, target: 'native' });
      assert.notEqual(h2, h1, 'imported nested file change must invalidate');

      // …while an unimported sibling in the same nested dir must not.
      const h3 = await computeBuildHash({ cwd: root, config: cfg, profile, target: 'native' });
      await writeFile(join(root, 'src', 'nested', 'unrelated.ts'), `export const x = 2;\n`);
      const h4 = await computeBuildHash({ cwd: root, config: cfg, profile, target: 'native' });
      assert.equal(h4, h3, 'unimported sibling change must not invalidate');

      // `.js` specifiers resolve to their `.ts` sibling
      const graph = await collectSourceGraph(join(root, 'src', 'core.ts'));
      assert.ok(graph.some((f) => f.endsWith('nested/helper.ts')), `graph: ${graph.join(', ')}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('hash changes when source changes', async () => {
    const before = await computeBuildHash({ cwd: workDir, config, profile, target: 'native' });
    await writeFile(join(workDir, 'src/core.ts'), 'export function add(a: number, b: number) { return a + b + 1; }\n');
    const after = await computeBuildHash({ cwd: workDir, config, profile, target: 'native' });
    assert.notEqual(before, after);
    await writeFile(join(workDir, 'src/core.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
  });

  it('hash changes when target differs', async () => {
    const native = await computeBuildHash({ cwd: workDir, config, profile, target: 'native' });
    const wasm = await computeBuildHash({ cwd: workDir, config, profile, target: 'wasm' });
    assert.notEqual(native, wasm);
  });

  it('miss → mark → hit lifecycle, and artifact presence is required', async () => {
    const outDir = join(workDir, '.scriptcable');
    await mkdir(outDir, { recursive: true });
    const hash = await computeBuildHash({ cwd: workDir, config, profile, target: 'native' });
    const artifact = join(outDir, 'libcachetest.dylib');

    // miss when no cache entry
    assert.equal(await isCachedBuild({ outDir, target: 'native', hash, artifactPaths: [artifact] }), false);

    // still miss when hash recorded but artifact missing
    await markBuildDone({ outDir, target: 'native', hash });
    assert.equal(await isCachedBuild({ outDir, target: 'native', hash, artifactPaths: [artifact] }), false);

    // hit once artifact exists
    await writeFile(artifact, 'fake');
    assert.equal(await isCachedBuild({ outDir, target: 'native', hash, artifactPaths: [artifact] }), true);

    // miss again when hash changes
    assert.equal(await isCachedBuild({ outDir, target: 'native', hash: 'different', artifactPaths: [artifact] }), false);
  });
});
