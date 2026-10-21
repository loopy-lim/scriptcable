/**
 * Runtime E2E for the webpack drop-in graph: `next start`, then curl the
 * API route — it must answer through the generated node drop-in
 * (`createClientSync()` → typed N-API addon → native library).
 * Verified manually on 2026-10-21 against Next 16.4.2; CI runs the same.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 3117;

const server = spawn('bun', ['--bun', 'next', 'start', '-p', String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function shutdown(code, message) {
  server.kill('SIGTERM');
  if (message) console.error(message);
  if (code !== 0) console.error(serverLog.slice(-2000));
  process.exit(code);
}
process.on('exit', () => server.kill('SIGTERM'));

let body = null;
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/calc`);
    if (res.ok) {
      body = await res.json();
      break;
    }
  } catch {
    /* server not up yet */
  }
  await new Promise((r) => setTimeout(r, 500));
}

if (!body) await shutdown(1, 'next-runtime-smoke FAIL — /api/calc never answered 200');
if (body.sum !== 42 || body.hi !== 'hello, next-server') {
  await shutdown(1, `next-runtime-smoke FAIL — unexpected body: ${JSON.stringify(body)}`);
}
console.log('next-runtime-smoke OK —', JSON.stringify(body), '(node drop-in via next start)');
process.exit(0);
