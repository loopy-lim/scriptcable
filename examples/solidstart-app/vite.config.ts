import scriptca from '@unikit-bridge/scriptca/vite';
import { solidStart } from '@solidjs/start/config';
import { defineConfig } from 'vite';

// SolidStart 2 embeds Vite — the scriptca plugin registers alongside the
// start plugin like any vite plugin. SPA mode: the client graph is the one
// the drop-in serves.
export default defineConfig({
  plugins: [solidStart({ ssr: false }), scriptca()],
  build: {
    // The drop-in browser client initializes WASM with top-level await.
    target: 'es2022',
  },
  optimizeDeps: {
    exclude: ['@unikit-bridge/scriptca/core', '@unikit-bridge/scriptca/core/wasm', '@unikit-bridge/scriptca/core/wasi'],
  },
});
