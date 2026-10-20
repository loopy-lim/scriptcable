import { defineConfig } from 'vite';
import scriptcable from '@scriptcable/vite';

export default defineConfig({
  plugins: [scriptcable()],
  build: { outDir: 'dist' },
  // Avoid prebundling the Node toolchain entry
  optimizeDeps: {
    exclude: ['@scriptcable/core'],
  },
});
