/**
 * SolidStart build assertions — the REAL vite build output (dist/) must:
 *   1. contain the drop-in browser client chain ("profile_format" is the
 *      embedded profile JSON — minify-safe, symbol names get mangled),
 *   2. NOT contain the TypeScript entry source (the greet template literal
 *      only exists in the original core),
 *   3. ship the compiled WASM as a static asset (copied into public/ by the
 *      plugin, moved into dist/ by vite).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const out = join(root, 'dist');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const files = [];
for await (const p of walk(out)) files.push(p);

const code = (
  await Promise.all(files.filter((f) => /\.(js|mjs)$/.test(f)).map((f) => readFile(f, 'utf8')))
).join('\n');

if (!code.includes('profile_format')) {
  throw new Error('solidstart drop-in OFF — no drop-in client in the bundle');
}
if (code.includes('hello, ${name}')) {
  throw new Error('solidstart drop-in OFF — the TS entry source is in the bundle');
}
const wasm = files.find((f) => f.endsWith('.wasm'));
if (!wasm) {
  throw new Error('solidstart: no .wasm static asset in dist — the plugin should copy it into public/');
}
console.log(`solidstart drop-in smoke OK — bundle uses the drop-in, ${wasm.split('/').pop()} shipped`);
