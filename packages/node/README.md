# @scriptca/node

```ts
import { createNodeEngineFromOutDir } from '@scriptca/node';

const engine = await createNodeEngineFromOutDir('.scriptca');
console.log(await engine.invoke('add', [20, 22])); // 42
engine.dispose?.();
```

Requires Node >= 24. Build the core first with `scriptca build`.
