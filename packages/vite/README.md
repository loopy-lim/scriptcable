# @scriptcable/vite

Builds the scriptc core on `buildStart` / HMR.

- Default project `target: "native"` → native shared lib for SSR + WASM when
  `target: "both"` (recommended for apps with a browser UI).
- Pure browser apps can set `"target": "wasm"` in `scriptcable.json`.

```ts
import scriptcable from '@scriptcable/vite';
export default { plugins: [scriptcable()] };
```
