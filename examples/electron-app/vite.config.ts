import { defineConfig } from 'vite';
import scriptcable from '@scriptcable/vite';

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
    exclude: ['@scriptcable/core', '@scriptcable/core/wasm', '@scriptcable/core/wasi'],
  },
});
