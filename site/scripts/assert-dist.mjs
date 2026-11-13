/**
 * Site build assertions — the REAL `vite build` output must:
 *   1. contain the drop-in browser client chain ("profile_format" is the
 *      embedded profile JSON — minify-safe, symbol names get mangled),
 *   2. NOT contain the TypeScript entry source (the greet template literal
 *      only exists in the original core),
 *   3. ship the compiled WASM as a static asset (copied into public/ by the
 *      plugin, emitted into dist/ by vite),
 *   4. contain the entry HTML and favicon.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const files = [];
for await (const p of walk(dist)) files.push(p);

const code = (
  await Promise.all(files.filter((f) => /\.(js|mjs|css)$/.test(f)).map((f) => readFile(f, 'utf8')))
).join('\n');

if (!code.includes('profile_format')) {
  throw new Error('site drop-in OFF — no drop-in client in the bundle');
}
if (code.includes('hello, ${name}')) {
  throw new Error('site drop-in OFF — the TS entry source is in the bundle');
}
const wasm = files.find((f) => f.endsWith('.wasm'));
if (!wasm) {
  throw new Error('site: no .wasm static asset in dist — the plugin should copy it into public/');
}
await stat(wasm); // readable
// The module-relative probe candidate must be a REAL wasm — on SPA-fallback
// hosts a missing /assets/<name>.wasm yields a 200 HTML page and
// WebAssembly.compile() dies on the index.html bytes.
const wasmName = wasm.split('/').pop();
const assetCopy = files.find((f) => f.endsWith(join('assets', wasmName)));
if (!assetCopy) {
  throw new Error(`site: assets/${wasmName} missing — postbuild.mjs should mirror it`);
}
const html = files.find((f) => f.endsWith('index.html'));
if (!html) throw new Error('site: dist/index.html missing');
const favicon = files.find((f) => f.endsWith('favicon.svg'));
if (!favicon) throw new Error('site: dist/favicon.svg missing');

const kb = (await stat(wasm)).size / 1024;
console.log(
  `site drop-in smoke OK — bundle uses the drop-in, ${wasm.split('/').pop()} shipped (${kb.toFixed(1)} kB)`,
);
