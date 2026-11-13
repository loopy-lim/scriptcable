import { defineConfig } from 'astro/config';
import scriptca from '@scriptca/vite';

// Astro embeds Vite — the scriptca plugin registers like any vite plugin.
export default defineConfig({
  vite: {
    plugins: [scriptca()],
    build: {
      // The drop-in browser client initializes WASM with top-level await.
      target: 'es2022',
    },
    optimizeDeps: {
      exclude: ['@scriptca/core', '@scriptca/core/wasm', '@scriptca/core/wasi'],
    },
  },
});
