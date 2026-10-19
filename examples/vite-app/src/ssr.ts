/** SSR / Node path — native shared library */
import { createNodeEngine } from '@scriptca/node';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../.scriptca');
const engine = await createNodeEngine({ outDir });
const result = {
  sum: engine.call('add', 20, 22),
  hi: engine.call('greet', 'vite-ssr'),
};
console.log(JSON.stringify(result));
engine.dispose?.();
