/**
 * Post-build: mirror the compiled WASM next to the emitted JS chunk.
 *
 * The drop-in browser client probes module-relative first (the chunk lives
 * in dist/assets/), then the origin root. On hosts with catch-all/SPA
 * fallback (vite preview, Cloudflare Pages) the module-relative HEAD gets
 * a 200 HTML page — the probe trusts it and WebAssembly.compile() fails on
 * the index.html bytes. Placing a real copy at dist/assets/<name>.wasm
 * makes the first candidate correct on every static host; the root copy
 * stays as the fallback candidate.
 */
import { copyFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const dist = join(import.meta.dirname, '..', 'dist');
const assets = join(dist, 'assets');

const wasmFiles = (await readdir(dist)).filter((f) => f.endsWith('.wasm'));
if (wasmFiles.length === 0) {
  throw new Error('postbuild: no .wasm in dist/ — did the core build run?');
}
for (const f of wasmFiles) {
  await copyFile(join(dist, f), join(assets, f));
  console.log(`postbuild: ${f} → assets/${f}`);
}
