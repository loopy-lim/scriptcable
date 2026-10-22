import { defineConfig } from 'astro/config';
import scriptcable from '@scriptcable/vite';

// Astro embeds Vite — the scriptcable plugin registers like any vite plugin.
export default defineConfig({
  vite: {
    plugins: [scriptcable()],
    build: {
      // The drop-in browser client initializes WASM with top-level await.
      target: 'es2022',
    },
    optimizeDeps: {
      exclude: ['@scriptcable/core', '@scriptcable/core/wasm', '@scriptcable/core/wasi'],
    },
  },
});
