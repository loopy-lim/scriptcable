/**
 * Integration test: `scriptcable init` scaffolds a CI-durable client dep —
 * placeholder manifest + package.json dep + gitignore negations — so a fresh
 * clone's `bun install` resolves `@scriptcable/client` before the first build.
 * Uses `--from` (local checkout) so the install never touches npm.
 */
import { describe, it, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInit } from './commands/init.js';

const repoRoot = resolve(import.meta.dir, '../../..'); // packages/cli/src → repo root
const tmpRoots: string[] = [];

afterAll(async () => {
  await Promise.all(tmpRoots.map((r) => rm(r, { recursive: true, force: true })));
});

describe('init CI-durable client dep (integration)', () => {
  it('scaffolds placeholder + dep + gitignore and installs cleanly', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'sc-init-it-'));
    tmpRoots.push(parent);
    // /var/folders is a symlink to /private/var/folders on macOS — init
    // computes relative file: paths from this dir, so use the real path.
    const realParent = await realpath(parent);
    const code = await runInit({ name: 'demo', cwd: realParent, host: 'bun', from: repoRoot });
    assert.equal(code, 0);
    const root = join(realParent, 'demo');

    // package.json carries the file: dep — even under --from overrides
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['@scriptcable/client'], 'file:.scriptcable/generated');

    // Placeholder manifest stands in until the first build overwrites it
    const placeholderPkg = JSON.parse(await readFile(join(root, '.scriptcable', 'generated', 'package.json'), 'utf8'));
    assert.equal(placeholderPkg.name, '@scriptcable/client');
    await readFile(join(root, '.scriptcable', 'generated', 'placeholder.ts'), 'utf8');

    // The two placeholder files are the committed surface of .scriptcable
    const gitignore = await readFile(join(root, '.gitignore'), 'utf8');
    assert.match(gitignore, /!\.scriptcable\/generated\/package\.json/);
    assert.match(gitignore, /!\.scriptcable\/generated\/placeholder\.ts/);

    // Fresh install succeeds (bun fails a file: dep without a package.json)
    const install = Bun.spawnSync({ cmd: ['bun', 'install'], cwd: root, stdout: 'pipe', stderr: 'pipe' });
    assert.equal(install.exitCode, 0, `bun install failed: ${String(install.stderr)}`);

    // And the bare specifier resolves to the placeholder until the first build
    const probe = Bun.spawnSync({
      cmd: ['bun', '-e', `import('@scriptcable/client').then((m) => console.log(typeof m.createClient))`],
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    assert.equal(probe.exitCode, 0, `client import failed: ${String(probe.stderr)}`);
    assert.equal(String(probe.stdout).trim(), 'function');
  }, 180_000);
});

describe('init name derivation (F-2 regression)', () => {
  it('derives package/config name from the directory basename — not the path', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'sc-init-f2-'));
    tmpRoots.push(parent);
    const realParent = await realpath(parent);
    const target = join(realParent, 'sc-PerfDemo');
    const code = await runInit({ name: target, host: 'bun' });
    assert.equal(code, 0);

    // 절대경로 인수여도 package.json name에 경로가 유출되지 않는다(소문자·URL 안전).
    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'sc-perfdemo');

    // scriptcable.config.ts의 name·prefix도 basename 기반
    const cfg = await readFile(join(target, 'scriptcable.config.ts'), 'utf8');
    assert.match(cfg, /name: 'sc-perfdemo'/);
    assert.match(cfg, /prefix: 'sc_perfdemo_'/);
  });

  it('falls back to a valid name when the basename sanitizes to empty', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'sc-init-f2b-'));
    tmpRoots.push(parent);
    const realParent = await realpath(parent);
    // basename이 전부 비-URL 문자 → 'app' 폴백
    const target = join(realParent, '한글프로젝트');
    const code = await runInit({ name: target, host: 'bun' });
    assert.equal(code, 0);
    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'app');
  });
});
