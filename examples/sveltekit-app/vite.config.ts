import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import scriptcable from '@unikit-bridge/scriptcable/vite';

export default defineConfig({
  plugins: [sveltekit(), scriptcable()],
  build: {
    // The drop-in browser client initializes WASM with top-level await.
    target: 'es2022',
  },
  optimizeDeps: {
    exclude: ['@unikit-bridge/scriptcable/core', '@unikit-bridge/scriptcable/core/wasm', '@unikit-bridge/scriptcable/core/wasi'],
  },
});
