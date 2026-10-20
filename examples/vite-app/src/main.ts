import { createClient } from '@scriptcable/client';

const out = document.getElementById('out')!;
out.textContent = 'loading core via @scriptcable/client…';

async function main() {
  // Browser graph → browser flavor (WASM); no paths, no WASI adapter needed.
  const client = await createClient();
  out.textContent = JSON.stringify({
    sum: client.add(20, 22),
    hi: client.greet('vite-browser'),
  });
  client.dispose();
}
main().catch((e) => {
  out.textContent = String(e);
});
