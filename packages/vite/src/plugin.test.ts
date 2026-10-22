/**
 * Plugin-level tests: zero-config loading + HMR rebuild gating.
 * Uses a real temp project; rebuild performs an actual scriptc compile once.
 */
import { describe, it, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scriptcable } from './index.js';

const repoRoot = resolve(import.meta.dir, '../../..'); // packages/vite/src → repo root
const tmpRoots: string[] = [];

afterAll(async () => {
  await Promise.all(tmpRoots.map((r) => rm(r, { recursive: true, force: true })));
});

async function makeProject(withTsConfig: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sc-vite-plugin-'));
  tmpRoots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'vite-plugin-it', private: true, type: 'module' }));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'src', 'core.ts'),
    `/** Adds. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n`,
  );
  if (withTsConfig) {
    await writeFile(
      join(root, 'scriptcable.config.ts'),
      `export default { name: 'ts-only', entry: 'src/core.ts' };\n`,
    );
  }
  const nm = join(root, 'node_modules');
  await mkdir(join(nm, '@scriptcable'), { recursive: true });
  await mkdir(join(nm, '.bin'), { recursive: true });
  await symlink(resolve(repoRoot, 'packages/core'), join(nm, '@scriptcable', 'core'), 'dir');
  await symlink(resolve(repoRoot, 'packages/types'), join(nm, '@scriptcable', 'types'), 'dir');
  await symlink(resolve(repoRoot, 'node_modules/scriptc'), join(nm, 'scriptc'), 'dir');
  await symlink(resolve(repoRoot, 'node_modules/.bin/scriptc'), join(nm, '.bin', 'scriptc'), 'file');
  return root;
}

function hotEvent(plugin: ReturnType<typeof scriptcable>, file: string) {
  const sent: unknown[] = [];
  const ctx = {
    file,
    server: { ws: { send: (msg: unknown) => sent.push(msg) }, restart: async () => {} },
  };
  return plugin.handleHotUpdate!(ctx).then(() => sent);
}

describe('vite plugin', () => {
  it('builds from scriptcable.config.ts (TS config, zero options)', async () => {
    const root = await makeProject(true);
    const plugin = scriptcable();
    plugin.configResolved!({ root });
    await plugin.buildStart!(); // rebuild → profile name must come from the TS config
    const profile = JSON.parse(await Bun.file(join(root, '.scriptcable', 'profile.json')).text());
    assert.equal(profile.name, 'ts-only');
    assert.equal(profile.exports.length, 1);
  }, 120_000);

  it('explicit root survives configResolved (Nuxt points vite root at its srcDir)', async () => {
    const root = await makeProject(false);
    const plugin = scriptcable({ root });
    // Nuxt-style: vite's resolved root is a subdirectory (srcDir), not the
    // project root — config discovery must stay on the explicit option.
    plugin.configResolved!({ root: join(root, 'app') });
    await plugin.buildStart!();
    const profile = JSON.parse(await Bun.file(join(root, '.scriptcable', 'profile.json')).text());
    assert.equal(profile.name, 'vite_plugin_it'); // inferred from the project root's package name
  }, 120_000);

  it('drop-in gate: build targets without TLA disable interception, es2022 and dev stay on', async () => {
    const root = await makeProject(false);
    const entryAbs = resolve(root, 'src', 'core.ts');
    const importer = resolve(root, 'src', 'app.ts');

    const dropinPathFor = async (command: string | undefined, target: unknown): Promise<string | null> => {
      const plugin = scriptcable();
      plugin.configResolved!({ root, publicDir: join(root, 'public'), command, build: { target } });
      await plugin.buildStart!();
      const hook = plugin.resolveId as {
        handler: (this: { resolve: () => { id: string } | null }, id: string, importer?: string) => Promise<string | null>;
      };
      return hook.handler.call({ resolve: () => ({ id: entryAbs }) }, './core', importer);
    };

    // vite 5/6 default ('modules' → safari 14) rejects top-level await — the
    // drop-in must stay off, or `vite build` would break (P1 regression).
    assert.equal(await dropinPathFor('build', ['es2020', 'safari14']), null, 'pre-TLA target must disable');
    assert.match((await dropinPathFor('build', 'es2022'))!, /dropin[\\/]browser\.ts$/, 'es2022 stays on');
    // Dev transforms with esnext — no gate applies.
    assert.match((await dropinPathFor('serve', ['es2020', 'safari14']))!, /dropin[\\/]browser\.ts$/);
  }, 180_000);

  it('HMR: rebuilds on entry change, skips unrelated files', async () => {
    const root = await makeProject(false);
    const plugin = scriptcable();
    plugin.configResolved!({ root });
    await plugin.buildStart!();

    // Unrelated source file — no rebuild, no reload
    const unrelated = await hotEvent(plugin, join(root, 'src', 'unrelated.ts'));
    assert.equal(unrelated.length, 0, 'unrelated file must not trigger full-reload');

    // Entry change — one full-reload
    const entryHits = await hotEvent(plugin, join(root, 'src', 'core.ts'));
    assert.equal(entryHits.length, 1, 'entry change must trigger exactly one full-reload');

    // Config file change — one full-reload
    await writeFile(join(root, 'scriptcable.json'), JSON.stringify({ name: 'renamed' }));
    const configHits = await hotEvent(plugin, join(root, 'scriptcable.json'));
    assert.equal(configHits.length, 1, 'config change must trigger exactly one full-reload');
  }, 180_000);
});
