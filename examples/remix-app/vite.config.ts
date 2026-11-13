import { reactRouter } from '@react-router/dev/vite';
import scriptca from '@unikit-bridge/scriptca/vite';
import { defineConfig } from 'vite';

// React Router v8 embeds Vite — the scriptca plugin registers like any
// vite plugin.
export default defineConfig({
  plugins: [reactRouter(), scriptca()],
  build: {
    // The drop-in browser client initializes WASM with top-level await.
    target: 'es2022',
  },
  optimizeDeps: {
    exclude: ['@unikit-bridge/scriptca/core', '@unikit-bridge/scriptca/core/wasm', '@unikit-bridge/scriptca/core/wasi'],
  },
});
