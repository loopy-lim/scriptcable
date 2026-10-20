import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fromCore = join(root, '../calculator-core/.scriptcable');
const fromLocal = join(root, '.scriptcable');
const from = existsSync(join(fromLocal, 'calculator.wasm'))
  ? fromLocal
  : fromCore;
const dest = join(root, 'public/.scriptcable');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
// Runtime artifacts only — generated TS in public/ would shadow vite's
// transformed module URLs with raw TypeScript in dev.
for (const f of ['calculator.wasm', 'profile.json']) {
  if (existsSync(join(from, f))) cpSync(join(from, f), join(dest, f));
}
console.log('synced public/.scriptcable from', from);
