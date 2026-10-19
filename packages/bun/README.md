# @scriptca/bun

Same artifacts as Node. Under Bun, loading uses built-in `bun:ffi` (no koffi).

```ts
import { createBunEngineFromOutDir } from '@scriptca/bun';
const engine = await createBunEngineFromOutDir('.scriptca');
console.log(engine.call('add', 20, 22));
```
