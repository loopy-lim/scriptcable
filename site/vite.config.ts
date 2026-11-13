import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import scriptca from '@unikit-bridge/scriptca/vite';

export default defineConfig({
  plugins: [react(), tailwindcss(), scriptca()],
  build: {
    outDir: 'dist',
    // The drop-in browser client initializes WASM with top-level await —
    // TLA shipped in every current browser (Chrome 89+, Safari 15+, FF 89+)
    // but sits above vite's conservative default build target.
    target: 'es2022',
  },
  optimizeDeps: {
    // @unikit-bridge/ui ships TypeScript source — prebundle it for the dev
    // server (esbuild compiles TS; the exports condition resolves the web
    // bridge, so react-native never enters the browser graph).
    include: ['@unikit-bridge/ui'],
    // Avoid prebundling the Node toolchain entries — core and its subpaths
    // must go through vite's normal transform, not the dep optimizer.
    exclude: [
      '@unikit-bridge/scriptca/core',
      '@unikit-bridge/scriptca/core/wasm',
      '@unikit-bridge/scriptca/core/wasi',
    ],
  },
});
