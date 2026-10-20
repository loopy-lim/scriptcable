import { createBunEngineFromOutDir } from '@scriptcable/bun';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '../../calculator-core');
const engine = await createBunEngineFromOutDir(join(coreRoot, '.scriptcable'));
console.log(JSON.stringify({
  sum: engine.call('add', 20, 22),
  product: engine.call('mul', 6, 7),
  hi: engine.call('greet', 'bun'),
}));
engine.dispose?.();
