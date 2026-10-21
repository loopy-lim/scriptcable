import { defineConfig } from 'vite';
import scriptcable from '@scriptcable/vite';

export default defineConfig({
  plugins: [scriptcable()],
  build: {
    outDir: 'dist',
    // The drop-in browser client initializes WASM with top-level await —
    // TLA shipped in every current browser (Chrome 89+, Safari 15+, FF 89+)
    // but sits above vite's conservative default build target.
    target: 'es2022',
  },
  // Avoid prebundling the Node toolchain entries — core and its subpaths
  // must go through vite's normal transform, not the dep optimizer.
  optimizeDeps: {
    exclude: ['@scriptcable/core', '@scriptcable/core/wasm', '@scriptcable/core/wasi'],
  },
});
