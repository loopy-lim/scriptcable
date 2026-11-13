import { defineConfig } from 'vite';
import scriptcable from '@unikit-bridge/scriptcable/vite';

export default defineConfig({
  // Project root stays at the package root so the plugin finds
  // scriptcable.json and the core entry — index.html sits beside it.
  base: './',
  plugins: [scriptcable()],
  build: {
    outDir: 'dist',
    // The drop-in browser client initializes WASM with top-level await.
    target: 'es2022',
  },
  optimizeDeps: {
    exclude: ['@unikit-bridge/scriptcable/core', '@unikit-bridge/scriptcable/core/wasm', '@unikit-bridge/scriptcable/core/wasi'],
  },
});
