import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import scriptcable from '@scriptcable/vite';

export default defineConfig({
  plugins: [sveltekit(), scriptcable()],
  build: {
    // The drop-in browser client initializes WASM with top-level await.
    target: 'es2022',
  },
  optimizeDeps: {
    exclude: ['@scriptcable/core', '@scriptcable/core/wasm', '@scriptcable/core/wasi'],
  },
});
