/**
 * Deno usage: one bare import — export conditions pick the deno flavor
 * (compiled .js, since Deno won't strip types under node_modules) and the
 * wasm is read from the generated directory. No flags, no config:
 *   scriptcable build --target wasm --hosts deno
 *   deno run -A src/main.ts
 *
 * Same API as every other flavor: createClient(), then typed calls.
 */
import { createClient } from '@scriptcable/client';

const client = await createClient();

const sum = client.add(20, 22);
const product = client.mul(6, 7);
const hi = client.greet('deno');

console.log(JSON.stringify({ sum, product, hi }));

if (sum !== 42 || product !== 42 || hi !== 'hello, deno') {
  console.error('deno smoke FAILED');
  Deno.exit(1);
}
console.log('deno smoke OK');
