/**
 * Workers smoke: bundle-level assertions on `wrangler deploy --dry-run`
 * output, then a real workerd runtime check — `wrangler dev` + HTTP fetch
 * asserting the wasm core answers through the workers flavor.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (out += d));
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}\n${out}`))));
  });
}

// 1) Bundle: the dry-run must produce a worker whose bundle carries the wasm
// loader chain and the workers flavor, not the original core source.
await run('bunx', ['wrangler', 'deploy', '--dry-run', '--outdir', 'dist']);
const bundle = await readFile(join(root, 'dist', 'index.js'), 'utf8');
if (!bundle.includes('scriptc_alloc')) throw new Error('bundle is missing the wasm loader');
if (bundle.includes('hello, ${name}')) throw new Error('bundle contains the original core source');
if (!bundle.includes('resolveModule')) throw new Error('bundle is missing the workers flavor');
// wrangler emits the wasm content-hash-prefixed (e.g. <hash>-calculator.wasm)
const wasmShipped = existsSync(join(root, 'dist')) &&
  (await import('node:fs/promises')).readdir(join(root, 'dist')).then((files) =>
    files.some((f) => f.endsWith('.wasm')),
  );
if (!(await wasmShipped)) throw new Error('dist/ is missing the compiled .wasm output');

// 2) Runtime: boot workerd, fetch the worker, assert the wasm core answers.
const proc = spawn(
  'bunx',
  ['wrangler', 'dev', '--port', String(PORT)],
  {
    cwd: root,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
    stdio: ['ignore', 'ignore', 'ignore'],
  },
);
try {
  let body;
  const deadline = Date.now() + 90_000;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`wrangler dev exited early: ${proc.exitCode}`);
    try {
      const res = await fetch(BASE);
      if (res.ok) {
        body = await res.json();
        break;
      }
      lastErr = new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      lastErr = e; // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!body) {
    throw new Error(`worker did not answer within 90s${lastErr ? `: ${lastErr.message}` : ''}`);
  }
  if (body.sum !== 42 || body.product !== 42 || body.hi !== 'hello, workers') {
    throw new Error(`unexpected worker response: ${JSON.stringify(body)}`);
  }
  console.log(JSON.stringify(body));
  console.log('workers smoke OK');
} finally {
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 2000));
  if (proc.exitCode === null) proc.kill('SIGKILL');
}
