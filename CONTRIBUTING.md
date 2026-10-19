# Contributing

## Setup

- Node.js 24+
- pnpm 9+
- zig 0.13.x on PATH (WASM)
- clang (native `.lib.a` on Linux)

```bash
pnpm install
pnpm build
pnpm --filter @scriptca/example-calculator-core build
pnpm --filter @scriptca/example-node-app test
```

## Layout

- `packages/*` — publishable packages
- `examples/*` — runnable demos / bridge tests
- Core compile path always goes through `scriptc build --lib --profile`

## Contracts

Breaking export signature changes must fail `scriptca diff`. Update the committed `.scriptca/contract.json` deliberately in the same PR when you intend a break (and bump major).
