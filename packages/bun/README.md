# @scriptca/bun

Bun host adapter. Loads the native shared library with built-in `bun:ffi`
(no koffi, no extra dependencies). WASM (WASI) stays available as an opt-in.

```ts
import { createBunEngineFromOutDir } from '@scriptca/bun';
const engine = await createBunEngineFromOutDir('.scriptca');
console.log(engine.call('add', 20, 22));
```
