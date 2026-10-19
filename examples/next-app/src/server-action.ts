/** Simulates a Next.js server action / route handler calling the native core */
import { createNodeEngine } from '@scriptca/node';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../.scriptca');
const engine = await createNodeEngine({ outDir });
console.log(JSON.stringify({
  sum: engine.call('add', 20, 22),
  hi: engine.call('greet', 'next-server'),
}));
engine.dispose?.();
