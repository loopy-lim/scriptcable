# @scriptca/node

Loads the **native shared library** (`.so` / `.dylib` / `.dll`) produced by
`scriptca build` via [koffi](https://koffi.dev). WASM is only used when you pass
`preferWasm: true` or the shared library is missing.

```ts
import { createNodeEngine } from '@scriptca/node';

const engine = await createNodeEngine({ outDir: '.scriptca' });
console.log(engine.call('add', 20, 22)); // 42
engine.dispose?.();
```

Requires Node ≥ 24 and a C toolchain (`clang`) to link the shared library.
