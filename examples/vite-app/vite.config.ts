import { defineConfig } from 'vite';
import scriptcable from '@scriptcable/vite';

export default defineConfig({
  plugins: [scriptcable()],
  build: { outDir: 'dist' },
  // Avoid prebundling the Node toolchain entries — core and its subpaths
  // must go through vite's normal transform, not the dep optimizer.
  optimizeDeps: {
    exclude: ['@scriptcable/core', '@scriptcable/core/wasm', '@scriptcable/core/wasi'],
  },
});
