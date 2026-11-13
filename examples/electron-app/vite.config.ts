import { defineConfig } from 'vite';
import scriptca from '@unikit-bridge/scriptca/vite';

export default defineConfig({
  // Project root stays at the package root so the plugin finds
  // scriptca.json and the core entry — index.html sits beside it.
  base: './',
  plugins: [scriptca()],
  build: {
    outDir: 'dist',
    // The drop-in browser client initializes WASM with top-level await.
    target: 'es2022',
  },
  optimizeDeps: {
    exclude: ['@unikit-bridge/scriptca/core', '@unikit-bridge/scriptca/core/wasm', '@unikit-bridge/scriptca/core/wasi'],
  },
});
