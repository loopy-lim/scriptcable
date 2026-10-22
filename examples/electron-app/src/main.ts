/**
 * Electron main process — the desktop host smoke:
 *
 *   1. `createClient()` from `@scriptcable/client` — export conditions pick
 *      the node flavor, which loads the compiled core inside Electron's own
 *      Node runtime (typed N-API addon first, shared-library fallback).
 *   2. The renderer, built by vite, runs the browser drop-in (WASM). Its
 *      result is polled off `window.__scriptcableResult`.
 *
 * dist/ is served over a custom `scriptcable://` protocol — fetch() on a
 * file:// page would be CORS-blocked. Exit code 0 only when BOTH flavors
 * return 42.
 */
import { app, BrowserWindow, protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { createClient } from '@scriptcable/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, '..', 'dist');

// GPU init can fail in headless/VM environments — software rendering is fine.
app.commandLine.appendSwitch('disable-gpu');

// The renderer fetches the WASM from this scheme — without supportFetchAPI
// (and standard, so relative URLs resolve) fetch() rejects the custom scheme.
// Must be called before app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'scriptcable', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

function check(label: string, value: unknown): boolean {
  const ok = value === 42;
  console.log(`electron ${label}: ${JSON.stringify(value)} ${ok ? 'OK' : 'FAIL (expected 42)'}`);
  return ok;
}

async function main(): Promise<number> {
  // protocol.handle needs the default session — only available after ready.
  await app.whenReady();

  // --- 1. main process: the native node flavor inside Electron's Node ---
  let mainOk = false;
  try {
    const client = await createClient();
    const greetOk = client.greet('main') === 'hello, main';
    console.log(`electron main greet: ${greetOk ? 'OK' : 'FAIL'}`);
    mainOk = check('main add(20, 22)', client.add(20, 22)) && greetOk;
  } catch (err) {
    console.log(`electron main: createClient threw — ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- 2. renderer: the vite-built browser drop-in (WASM) ---
  protocol.handle('scriptcable', async (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(distDir, rel);
    // 404 for the browser client's probe candidates (module-relative before
    // origin root) instead of an unhandled ENOENT stack.
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return new Response('not found', { status: 404 });
    }
    return new Response(body, {
      headers: { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' },
    });
  });

  let rendererOk = false;
  try {
    const win = new BrowserWindow({ show: false });
    await win.loadURL('scriptcable://app/index.html');
    // The drop-in initializes WASM via top-level await right after the
    // module executes — poll until the renderer sets its result.
    let value: number | null = null;
    for (let i = 0; i < 50 && value === null; i++) {
      value = await win.webContents.executeJavaScript('window.__scriptcableResult ?? null', true);
      if (value === null) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    win.destroy();
    if (value === null) console.log('electron renderer: no result — the drop-in module never set __scriptcableResult');
    rendererOk = value !== null && check('renderer add(20, 22)', value);
  } catch (err) {
    console.log(`electron renderer: threw — ${err instanceof Error ? err.message : String(err)}`);
  }

  return mainOk && rendererOk ? 0 : 1;
}

main()
  .then((code) => {
    console.log(code === 0 ? 'electron smoke OK' : 'electron smoke FAILED');
    app.exit(code);
  })
  .catch((err) => {
    console.error('electron smoke CRASHED', err);
    app.exit(1);
  });
