# @scriptca/vite

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import scriptca from '@scriptca/vite';

export default defineConfig({
  plugins: [scriptca()],
});
```

```ts
import { createClient } from 'virtual:scriptca';
// provide a browser WASI polyfill when instantiating
```

On `buildStart` and when `scriptca.json` / core entry changes, the plugin runs `scriptc` (WASM) and regenerates clients.
