/**
 * Rollup compatibility: the plugin's resolveId hook uses the standard
 * rollup object shape ({ handler, order }) and rollup — unlike vite — has
 * NO configResolved, so the redirect must work from the explicit `root`
 * option alone. TypeScript transformation is the host's job on rollup, so
 * the test supplies the two standard companion plugins a rollup user would
 * (an esbuild ts transform + the .js→.ts sibling resolution the generated
 * clients rely on). vite's own transformWithEsbuild provides the transform.
 */
import { describe, it, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { rollup } from 'rollup';
import { transformWithEsbuild } from 'vite';
import { scriptcable } from './index.js';

const repoRoot = resolve(import.meta.dir, '../../..'); // packages/vite/src → repo root
const tmpRoots: string[] = [];

afterAll(async () => {
  await Promise.all(tmpRoots.map((r) => rm(r, { recursive: true, force: true })));
});

async function makeProject(appSource?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sc-rollup-'));
  tmpRoots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'rollup-it', private: true, type: 'module' }));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'src', 'core.ts'),
    `/** Adds. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n`,
  );
  await writeFile(join(root, 'src', 'app.ts'), appSource ?? '');
  const nm = join(root, 'node_modules');
  await mkdir(join(nm, '@scriptcable'), { recursive: true });
  await mkdir(join(nm, '.bin'), { recursive: true });
  await symlink(resolve(repoRoot, 'packages/core'), join(nm, '@scriptcable', 'core'), 'dir');
  await symlink(resolve(repoRoot, 'packages/types'), join(nm, '@scriptcable', 'types'), 'dir');
  await symlink(resolve(repoRoot, 'node_modules/scriptc'), join(nm, 'scriptc'), 'dir');
  await symlink(resolve(repoRoot, 'node_modules/.bin/scriptc'), join(nm, '.bin', 'scriptc'), 'file');
  return root;
}

const APP_WITH_DROPIN_ONLY =
  // getScriptcableClient is drop-in-only (the TS entry doesn't export it) —
  // importing it keeps the assertion tree-shake-proof and proves the
  // redirect actually served the drop-in's module surface.
  `import { add, getScriptcableClient } from './core';\nconsole.log(add(20, 22), typeof getScriptcableClient());\n`;
const APP_PLAIN = `import { add } from './core';\nconsole.log(add(20, 22));\n`;

// Standard rollup companions: transform TS with esbuild, and resolve the
// generated clients' .js specifiers to their .ts siblings.
function rollupTsCompanions() {
  return [
    {
      name: 'test-js-to-ts-siblings',
      async resolveId(source: string, importer?: string) {
        // Extensionless relative imports — rollup's default resolver doesn't
        // try extensions (node-resolve's job); map './core' → './core.ts'.
        if (source.startsWith('.') && !/\.[jt]s$/.test(source) && importer) {
          const base = resolve(dirname(importer), source);
          return (await Bun.file(`${base}.ts`).exists()) ? `${base}.ts` : null;
        }
        if (source.endsWith('.js') && importer?.includes('.scriptcable')) {
          const candidate = resolve(dirname(importer), `${source.slice(0, -3)}.ts`);
          return (await Bun.file(candidate).exists()) ? candidate : null;
        }
        return null;
      },
    },
    {
      name: 'test-esbuild-ts',
      async load(id: string) {
        if (!id.endsWith('.ts')) return null;
        const src = await Bun.file(id).text();
        return (await transformWithEsbuild(src, id, { loader: 'ts' })).code;
      },
    },
  ];
}

describe('rollup compatibility', () => {
  it('redirects entry imports onto the drop-in in a real rollup build', async () => {
    const root = await makeProject(APP_WITH_DROPIN_ONLY);
    const bundle = await rollup({
      input: join(root, 'src', 'app.ts'),
      plugins: [scriptcable({ root }), ...rollupTsCompanions()],
    });
    const { output } = await bundle.generate({ format: 'es' });
    const code = output.map((o) => (o.type === 'chunk' ? o.code : '')).join('\n');
    assert.ok(code.includes('getScriptcableClient'), 'the drop-in client should be in the bundle');
    assert.ok(!code.includes('return a + b'), 'the TS entry source should NOT be in the bundle');
  }, 180_000);

  it('dropin: false leaves the entry untouched', async () => {
    const root = await makeProject(APP_PLAIN);
    const bundle = await rollup({
      input: join(root, 'src', 'app.ts'),
      plugins: [scriptcable({ root, dropin: false }), ...rollupTsCompanions()],
    });
    const { output } = await bundle.generate({ format: 'es' });
    const code = output.map((o) => (o.type === 'chunk' ? o.code : '')).join('\n');
    assert.ok(code.includes('return a + b'), 'the original TS entry should stay in the bundle');
    assert.ok(!code.includes('getScriptcableClient'), 'no drop-in in the bundle');
  }, 180_000);
});
