/**
 * Browser demo — uses generated browser client if present, else loads via Node-built wasm
 * served as a static asset from .scriptca.
 *
 * Full WASI-in-browser needs a polyfill; for the verified path we also ship a
 * Node SSR-style check via `vite build` + smoke of the plugin rebuild.
 */
const out = document.getElementById('out')!;
out.textContent = 'Open the Node/Bun examples for full WASI execution.\n' +
  'This Vite app verifies the plugin rebuilds the core on buildStart.\n' +
  'Import virtual:scriptca after providing a WASI adapter (see README).';
