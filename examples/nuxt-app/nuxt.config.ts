import { fileURLToPath } from 'node:url';
import scriptca from '@unikit-bridge/scriptca/vite';

// Nuxt embeds Vite — the scriptca plugin registers like any vite plugin.
// SPA mode (ssr: false): the client graph is the one the drop-in serves.
// Nuxt 4 points vite's root at its srcDir (app/), so the plugin gets an
// explicit project root — everything else is zero-config.
export default defineNuxtConfig({
  ssr: false,
  vite: {
    plugins: [scriptca({ root: fileURLToPath(new URL('.', import.meta.url)) })],
    build: {
      // The drop-in browser client initializes WASM with top-level await.
      target: 'es2022',
    },
    optimizeDeps: {
      exclude: ['@unikit-bridge/scriptca/core', '@unikit-bridge/scriptca/core/wasm', '@unikit-bridge/scriptca/core/wasi'],
    },
  },
});
