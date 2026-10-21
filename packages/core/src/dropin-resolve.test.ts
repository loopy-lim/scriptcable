/**
 * Unit tests for the shared enhanced-resolve plugin: requests that resolve
 * to the core entry are redirected onto the drop-in client; everything else
 * (bare specifiers, unrelated relatives, internal requests) is delegated to
 * the default resolution untouched.
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ScriptcableDropinResolvePlugin } from './dropin-resolve.js';

// Real (per-platform) absolute paths: on Windows, path.resolve() rewrites
// fake POSIX absolutes like /proj/... onto the current drive, which would
// break the plugin's comparison against the entry.
const PROJ = resolve(tmpdir(), 'sc-dropin-resolve-stub');
const ENTRY = join(PROJ, 'src', 'core.ts');
const DROPIN = join(PROJ, '.scriptcable', 'generated', 'dropin', 'browser.ts');

type Captured = { redirected: (string | undefined)[]; delegated: string[] };

/** Stub resolver with the enhanced-resolve hook surface the plugin uses. */
function stubResolver(): { resolver: Parameters<ScriptcableDropinResolvePlugin['apply']>[0]; captured: Captured } {
  const captured: Captured = { redirected: [], delegated: [] };
  const hook = {
    tapAsync: (_name: string, fn: (request: any, ctx: any, cb: any) => void) => {
      hook.fn = fn;
    },
    fn: null as ((request: any, ctx: any, cb: any) => void) | null,
  };
  const resolver = {
    ensureHook: (name: string) => ({ hook: name }),
    getHook: (name: string) => hook,
    doResolve: (_target: unknown, request: any, _message: string | null, _ctx: unknown, cb: any) => {
      captured.redirected.push(request.request);
      cb(null, { redirectedTo: request.request });
    },
  };
  return { resolver: resolver as unknown as Parameters<ScriptcableDropinResolvePlugin['apply']>[0], captured, hook };
}

function run(plugin: ScriptcableDropinResolvePlugin, request: { path: string; request: string }): Captured {
  const { resolver, captured, hook } = stubResolver();
  plugin.apply(resolver);
  assert.ok(hook.fn, 'plugin never tapped the resolve hook');
  let outcome: unknown;
  hook.fn!(request, {}, (_err: unknown, result: unknown) => {
    outcome = result;
  });
  if (outcome === undefined) captured.delegated.push(request.request);
  return captured;
}

describe('ScriptcableDropinResolvePlugin', () => {
  const plugin = new ScriptcableDropinResolvePlugin(ENTRY, DROPIN);

  it('redirects a relative import that resolves to the entry', () => {
    const captured = run(plugin, { path: join(PROJ, 'src'), request: './core' });
    assert.deepEqual(captured.redirected, [DROPIN]);
    assert.equal(captured.delegated.length, 0);
  });

  it('redirects with an explicit extension and from a parent directory', () => {
    const cases: Array<{ path: string; request: string }> = [
      { path: join(PROJ, 'src'), request: './core.ts' },
      { path: join(PROJ, 'app'), request: '../src/core.ts' },
      { path: join(PROJ, 'app', 'x'), request: '../../src/core.ts' },
    ];
    for (const req of cases) {
      const captured = run(plugin, req);
      assert.deepEqual(captured.redirected, [DROPIN], `request ${req.request} from ${req.path} must redirect`);
    }
  });

  it('delegates unrelated relative requests and bare specifiers', () => {
    for (const req of ['./utils', './core-utils', './core/index.ts', '@app/core', 'node:path', './core.test.ts']) {
      const captured = run(plugin, { path: '/proj/src', request: req });
      assert.deepEqual(captured.redirected, [], `request ${req} must not redirect`);
      assert.deepEqual(captured.delegated, [req]);
    }
  });

  it('never throws into the resolver — malformed requests delegate', () => {
    const captured = run(plugin, { path: '/proj/src', request: '\0internal' });
    assert.deepEqual(captured.redirected, []);
    assert.deepEqual(captured.delegated, ['\0internal']);
  });

  it('redirects through a real enhanced-resolve resolver', async () => {
    // Real-library integration — the stub above pins the hook semantics,
    // this one pins the enhanced-resolve wiring (tap point, doResolve shape).
    let enhanced: typeof import('enhanced-resolve');
    try {
      enhanced = await import('enhanced-resolve');
    } catch {
      console.warn('enhanced-resolve not installed — skipping integration case');
      return;
    }
    const { mkdtemp, mkdir, writeFile, realpath } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    // Realpath up front: macOS /var → /private/var, and Windows tmpdir()
    // reports 8.3 short names (RUNNER~1) that enhanced-resolve resolves to
    // the long form — every path handed to the resolver must be the real one.
    const proj = await realpath(await mkdtemp(join(tmpdir(), 'sc-dropin-resolve-')));
    await mkdir(join(proj, 'src'), { recursive: true });
    await writeFile(join(proj, 'src', 'core.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
    await writeFile(join(proj, 'src', 'other.ts'), 'export const other = 1;\n');
    const dropin = join(proj, '.scriptcable', 'generated', 'dropin', 'browser.ts');
    await mkdir(join(proj, '.scriptcable', 'generated', 'dropin'), { recursive: true });
    await writeFile(dropin, 'export const dropin = true;\n');

    const resolver = enhanced.ResolverFactory.createResolver({
      fileSystem: await import('node:fs'),
      extensions: ['.ts', '.js'],
      plugins: [new ScriptcableDropinResolvePlugin(join(proj, 'src', 'core.ts'), dropin)],
    });
    const resolveIt = (context: string, request: string) =>
      new Promise<string | false>((done, reject) => {
        resolver.resolve({}, context, request, {}, (err, result) => (err ? reject(err) : done(result ?? false)));
      });

    // macOS /var → /private/var: enhanced-resolve reports the real path.
    const dropinReal = await realpath(dropin);
    const otherReal = await realpath(join(proj, 'src', 'other.ts'));
    assert.equal(await resolveIt(join(proj, 'src'), './core'), dropinReal, './core must land on the drop-in');
    assert.equal(await resolveIt(join(proj, 'src'), './core.ts'), dropinReal, 'explicit .ts must land on the drop-in');
    assert.equal(await resolveIt(join(proj, 'src'), './other'), otherReal, 'unrelated must pass through');
  });
});
