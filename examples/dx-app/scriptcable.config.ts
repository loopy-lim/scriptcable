import { defineConfig } from '@scriptcable/core';

export default defineConfig({
  name: 'dxapp',
  entry: 'src/core.ts',
  prefix: 'dxapp_',
});
