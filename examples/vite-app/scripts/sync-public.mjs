import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fromCore = join(root, '../calculator-core/.scriptca');
const fromLocal = join(root, '.scriptca');
const from = existsSync(join(fromLocal, 'calculator.wasm'))
  ? fromLocal
  : fromCore;
const dest = join(root, 'public/.scriptca');
rmSync(dest, { recursive: true, force: true });
mkdirSync(join(root, 'public'), { recursive: true });
cpSync(from, dest, { recursive: true });
console.log('synced public/.scriptca from', from);
