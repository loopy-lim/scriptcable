import { createClient } from '@scriptcable/client';
import { dropinAnswers } from './dropin-app';

const out = document.getElementById('out')!;
out.textContent = 'loading core via @scriptcable/client…';

async function main() {
  // Browser graph → browser flavor (WASM); no paths, no WASI adapter needed.
  const client = await createClient();
  out.textContent = JSON.stringify({
    sum: client.add(20, 22),
    hi: client.greet('vite-browser'),
    // dropin-app.ts imports the core entry directly — the plugin redirected
    // it onto the compiled client, so this runs at WASM speed with no
    // client-object ceremony in the importing code.
    dropin: dropinAnswers,
  });
  client.dispose();
}
main().catch((e) => {
  out.textContent = String(e);
});
