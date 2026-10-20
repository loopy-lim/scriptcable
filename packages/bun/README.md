# @scriptcable/bun

Bun host adapter. Loads the native shared library with built-in `bun:ffi`
(no koffi, no extra dependencies). WASM (WASI) stays available as an opt-in.

```ts
import { createBunEngineFromOutDir } from '@scriptcable/bun';
const engine = await createBunEngineFromOutDir('.scriptcable');
console.log(engine.call('add', 20, 22));
```
