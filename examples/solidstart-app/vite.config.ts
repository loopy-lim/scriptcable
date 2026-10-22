import scriptcable from '@scriptcable/vite';
import { solidStart } from '@solidjs/start/config';
import { defineConfig } from 'vite';

// SolidStart 2 embeds Vite — the scriptcable plugin registers alongside the
// start plugin like any vite plugin. SPA mode: the client graph is the one
// the drop-in serves.
export default defineConfig({
  plugins: [solidStart({ ssr: false }), scriptcable()],
  build: {
    // The drop-in browser client initializes WASM with top-level await.
    target: 'es2022',
  },
  optimizeDeps: {
    exclude: ['@scriptcable/core', '@scriptcable/core/wasm', '@scriptcable/core/wasi'],
  },
});
