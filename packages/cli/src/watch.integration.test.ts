/**
 * Integration test: `scriptcable build --watch`. Spawns the real CLI in a
 * temp project, edits the core, and asserts the automatic rebuild — including
 * the keep-watching-through-errors behavior.
 */
import { describe, it, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '../../..'); // packages/cli/src → repo root
const cliEntry = join(repoRoot, 'packages', 'cli', 'src', 'index.ts');
const tmpRoots: string[] = [];

const CORE_V1 = `/** Adds two numbers. */
export function add(a: number, b: number): number {
  return a + b;
}
`;
const CORE_V2 = `/** Adds two numbers. */
export function add(a: number, b: number): number {
  return a + b;
}

/** Multiplies two numbers. */
export function mul(a: number, b: number): number {
  return a * b;
}
`;
const CORE_BROKEN = `/** Adds two numbers. */
export function add(a: number, b: number): number {
  return a + ;
}
`;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sc-watch-it-'));
  tmpRoots.push(root);
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'watch_it', version: '0.1.0', private: true, type: 'module' }, null, 2),
  );
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'core.ts'), CORE_V1);
  const nm = join(root, 'node_modules');
  await mkdir(join(nm, '@scriptcable'), { recursive: true });
  await mkdir(join(nm, '@scriptc'), { recursive: true });
  await mkdir(join(nm, '.bin'), { recursive: true });
  await symlink(resolve(repoRoot, 'packages/core'), join(nm, '@scriptcable', 'core'), 'dir');
  await symlink(resolve(repoRoot, 'packages/types'), join(nm, '@scriptcable', 'types'), 'dir');
  await symlink(resolve(repoRoot, 'node_modules/scriptc'), join(nm, 'scriptc'), 'dir');
  await symlink(resolve(repoRoot, 'node_modules/.bin/scriptc'), join(nm, '.bin', 'scriptc'), 'file');
  return root;
}

/** Incremental stdout reader — resolves when `re` matches the accumulated output. */
function makeWatcher(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return async function waitFor(re: RegExp, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (!re.test(buf)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timeout waiting for ${re}\n--- output so far ---\n${buf}`);
      const timer = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), remaining));
      const chunk = await Promise.race([reader.read(), timer]);
      if (chunk === 'timeout') continue;
      if (chunk.done) break;
      buf += dec.decode(chunk.value);
    }
    if (!re.test(buf)) throw new Error(`stream ended before ${re}\n--- output ---\n${buf}`);
    return buf;
  };
}

afterAll(async () => {
  await Promise.all(tmpRoots.map((r) => rm(r, { recursive: true, force: true })));
});

describe('build --watch (integration)', () => {
  it('rebuilds when the core changes', async () => {
    const project = await makeProject();
    const child = Bun.spawn({
      cmd: [process.execPath, cliEntry, 'build', '--watch'],
      cwd: project,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const out = makeWatcher(child.stdout);
    try {
      await out(/watching for changes/, 90_000); // initial build done
      // Let the watcher's first stamps settle, then edit the core
      await new Promise((r) => setTimeout(r, 600));
      await writeFile(join(project, 'src', 'core.ts'), CORE_V2);
      await out(/rebuilt in \d+ms/, 60_000);
      const nodeSrc = await readFile(join(project, '.scriptcable', 'generated', 'node.ts'), 'utf8');
      assert.match(nodeSrc, /mul\(a: number, b: number\): number/, 'rebuilt client missing the new export');
    } finally {
      child.kill();
      await child.exited;
    }
  }, 150_000);

  it('keeps watching through a broken core and recovers', async () => {
    const project = await makeProject();
    const child = Bun.spawn({
      cmd: [process.execPath, cliEntry, 'build', '--watch'],
      cwd: project,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const out = makeWatcher(child.stdout);
    try {
      await out(/watching for changes/, 90_000);
      await new Promise((r) => setTimeout(r, 600));
      await writeFile(join(project, 'src', 'core.ts'), CORE_BROKEN);
      await out(/still watching/, 60_000); // error reported, watcher alive
      await new Promise((r) => setTimeout(r, 600));
      await writeFile(join(project, 'src', 'core.ts'), CORE_V2);
      await out(/rebuilt in \d+ms/, 60_000);
      await access(join(project, '.scriptcable', 'generated', 'node.ts'));
    } finally {
      child.kill();
      await child.exited;
    }
  }, 180_000);
});
