import { defineConfig } from 'vite';
import scriptca from '@scriptca/vite';

export default defineConfig({
  plugins: [scriptca()],
  build: { outDir: 'dist' },
  // Avoid prebundling the Node toolchain entry
  optimizeDeps: {
    exclude: ['koffi', '@scriptca/core'],
  },
  ssr: {
    external: ['koffi'],
  },
});
