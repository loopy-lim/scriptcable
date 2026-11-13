import { reactRouter } from '@react-router/dev/vite';
import scriptcable from '@unikit-bridge/scriptcable/vite';
import { defineConfig } from 'vite';

// React Router v8 embeds Vite — the scriptcable plugin registers like any
// vite plugin.
export default defineConfig({
  plugins: [reactRouter(), scriptcable()],
  build: {
    // The drop-in browser client initializes WASM with top-level await.
    target: 'es2022',
  },
  optimizeDeps: {
    exclude: ['@unikit-bridge/scriptcable/core', '@unikit-bridge/scriptcable/core/wasm', '@unikit-bridge/scriptcable/core/wasi'],
  },
});
