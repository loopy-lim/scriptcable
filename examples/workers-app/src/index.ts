/**
 * Cloudflare Workers usage: one bare import — wrangler resolves the package
 * with the `workerd` condition, so the workers flavor is bundled with the
 * wasm as a static CompiledWasm import. Same API as every other flavor.
 *   scriptcable build --target wasm --hosts workers
 *   wrangler dev
 */
import { createClient } from '@scriptcable/client';

let clientPromise: ReturnType<typeof createClient> | null = null;
function client(): ReturnType<typeof createClient> {
  return (clientPromise ??= createClient());
}

export default {
  async fetch(): Promise<Response> {
    const c = await client();
    const sum = c.add(20, 22);
    const product = c.mul(6, 7);
    const hi = c.greet('workers');
    if (sum !== 42 || product !== 42 || hi !== 'hello, workers') {
      return new Response(`worker smoke FAILED: ${JSON.stringify({ sum, product, hi })}`, { status: 500 });
    }
    return Response.json({ sum, product, hi });
  },
};
