import { createMinimalWasi } from '@scriptca/core/wasi';
import { loadWasmModule } from '@scriptca/core/wasm';

const out = document.getElementById('out')!;
out.textContent = 'loading wasm…';

async function main() {
  const profile = await (await fetch('/.scriptca/profile.json')).json();
  const bytes = await (await fetch('/.scriptca/calculator.wasm')).arrayBuffer();
  const mod = await loadWasmModule(bytes, { profile, wasi: createMinimalWasi() });
  out.textContent = JSON.stringify({
    sum: mod.call('add', 20, 22),
    hi: mod.call('greet', 'vite-browser'),
  });
}
main().catch((e) => {
  out.textContent = String(e);
});
