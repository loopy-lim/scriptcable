import { createNodeEngineFromOutDir } from '@scriptcable/node';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '../../calculator-core');
const engine = await createNodeEngineFromOutDir(join(coreRoot, '.scriptcable'));

const sum = engine.call('add', 20, 22);
const product = engine.call('mul', 6, 7);
const hi = engine.call('greet', 'node');

console.log(JSON.stringify({ sum, product, hi }));

engine.dispose?.();
