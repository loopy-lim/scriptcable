import { defineConfig } from 'vite';
import scriptca from '@scriptca/vite';

export default defineConfig({
  plugins: [scriptca()],
  server: { port: 5173 },
});
