# @scriptca/node

Loads the **native shared library** (`.so` / `.dylib` / `.dll`) produced by
`scriptca build`. Under **Bun** (the default engine) loading uses built-in
`bun:ffi` — no extra dependency. Under plain Node, install `koffi` as an
optional fallback. WASM is only used when you pass `preferWasm: true` or the
shared library is missing.

```ts
import { createNodeEngine } from '@scriptca/node';

const engine = await createNodeEngine({ outDir: '.scriptca' });
console.log(engine.call('add', 20, 22)); // 42
engine.dispose?.();
```

Requires Bun ≥ 1.2 (or Node ≥ 24 with koffi) and a C toolchain (`clang`) to
link the shared library.
