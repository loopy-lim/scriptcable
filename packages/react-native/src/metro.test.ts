/**
 * Metro drop-in resolver tests (stub resolution context — no Metro install
 * needed): entry requests redirect onto the generated RN drop-in, everything
 * else delegates to the default resolution, and an existing custom resolver
 * keeps priority.
 */
import { describe, it, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createScriptcableResolveRequest, withScriptcableMetro } from './metro.js';
import type { MetroResolveContext, MetroResolution } from './metro.js';

const tmpRoots: string[] = [];
afterAll(async () => {
  await Promise.all(tmpRoots.map((r) => rm(r, { recursive: true, force: true })));
});

async function makeProject(opts: { withDropin: boolean }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sc-metro-'));
  tmpRoots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'src', 'core.ts'),
    `/** Adds. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n`,
  );
  if (opts.withDropin) {
    await mkdir(join(root, '.scriptcable', 'generated', 'dropin'), { recursive: true });
    await writeFile(join(root, '.scriptcable', 'generated', 'dropin', 'react-native.ts'), `export const add = 0;\n`);
  }
  return root;
}

function ctxOf(origin: string, delegated: MetroResolution[] = []): { context: MetroResolveContext; delegated: MetroResolution[] } {
  const context: MetroResolveContext = {
    originPath: origin,
    resolveRequest: (ctx, moduleName) => {
      const result: MetroResolution = { type: 'sourceFile', filePath: `default:${moduleName}` };
      delegated.push(result);
      return result;
    },
  };
  return { context, delegated };
}

describe('metro drop-in resolver', () => {
  it('redirects entry imports onto the generated RN drop-in', async () => {
    const root = await makeProject({ withDropin: true });
    const resolveRequest = createScriptcableResolveRequest({ cwd: root });
    assert.ok(resolveRequest, 'resolver must exist for a project with a standard entry');
    const { context, delegated } = ctxOf(join(root, 'src', 'App.tsx'));
    const result = resolveRequest(context, './core', 'ios');
    assert.equal(result?.type, 'sourceFile');
    assert.equal(result?.filePath, join(root, '.scriptcable', 'generated', 'dropin', 'react-native.ts'));
    assert.deepEqual(delegated, [], 'redirected requests must not hit the default resolution');
  });

  it('delegates unrelated requests to the default resolution', async () => {
    const root = await makeProject({ withDropin: true });
    const resolveRequest = createScriptcableResolveRequest({ cwd: root });
    assert.ok(resolveRequest);
    const { context, delegated } = ctxOf(join(root, 'src', 'App.tsx'));
    for (const req of ['react-native', './useCable', '../src/core.test.ts']) {
      assert.equal(resolveRequest(context, req, 'android')?.filePath, `default:${req}`, req);
    }
    assert.equal(delegated.length, 3);
  });

  it('delegates even the entry when no drop-in has been built yet', async () => {
    const root = await makeProject({ withDropin: false });
    const resolveRequest = createScriptcableResolveRequest({ cwd: root });
    assert.ok(resolveRequest);
    const { context, delegated } = ctxOf(join(root, 'src', 'App.tsx'));
    assert.equal(resolveRequest(context, './core', 'ios')?.filePath, 'default:./core');
    assert.equal(delegated.length, 1);
  });

  it('returns null for projects without an entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc-metro-empty-'));
    tmpRoots.push(root);
    assert.equal(createScriptcableResolveRequest({ cwd: root }), null);
  });

  it('withScriptcableMetro wraps the config and keeps an existing resolver in front', async () => {
    const root = await makeProject({ withDropin: true });
    const existing = (ctx: MetroResolveContext, moduleName: string): MetroResolution | null =>
      moduleName === 'mine' ? { type: 'sourceFile', filePath: 'custom' } : null;
    const config = withScriptcableMetro({ resolver: { resolveRequest: existing } }, { cwd: root });
    const chained = config.resolver?.resolveRequest;
    assert.ok(chained);
    const { context, delegated } = ctxOf(join(root, 'src', 'App.tsx'));
    assert.equal(chained(context, 'mine', 'ios')?.filePath, 'custom', 'existing resolver keeps priority');
    assert.equal(chained(context, './core', 'ios')?.filePath, join(root, '.scriptcable', 'generated', 'dropin', 'react-native.ts'));
    assert.deepEqual(delegated, []);
  });

  it('withScriptcableMetro is a no-op without an entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc-metro-empty-'));
    tmpRoots.push(root);
    const config = { resolver: {} };
    assert.equal(withScriptcableMetro(config, { cwd: root }), config);
  });
});
