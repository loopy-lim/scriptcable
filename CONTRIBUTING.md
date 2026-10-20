# Contributing

## Setup

- Bun 1.2+
- zig 0.13.x on PATH (WASM)
- clang (native `.lib.a` on Linux)

```bash
bun install
bun run build
bun run --filter @scriptcable/example-calculator-core build
bun run --filter @scriptcable/example-node-app test
```

## Layout

- `packages/*` — publishable packages
- `examples/*` — runnable demos / bridge tests
- Core compile path always goes through `scriptc build --lib --profile`
- No Rust/C++ build steps in this repo — everything runs on Bun + scriptc

## Contracts

Breaking export signature changes must fail `scriptcable diff`. Update the committed `.scriptcable/contract.json` deliberately in the same PR when you intend a break (and bump major).
