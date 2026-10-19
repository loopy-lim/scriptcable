# @scriptca/vite

Builds the scriptc core on `buildStart` / HMR.

- Default project `target: "native"` → native shared lib for SSR + WASM when
  `target: "both"` (recommended for apps with a browser UI).
- Pure browser apps can set `"target": "wasm"` in `scriptca.json`.

```ts
import scriptca from '@scriptca/vite';
export default { plugins: [scriptca()] };
```
