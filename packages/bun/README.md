# @scriptca/bun

```ts
import { createBunEngineFromOutDir } from '@scriptca/bun';
const engine = await createBunEngineFromOutDir('.scriptca');
console.log(engine.call('add', 20, 22));
```

Same WASM artifact as Node. Run with `bun run`.
