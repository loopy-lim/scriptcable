English | [Korean](./README.ko.md)

# scriptca

One **TypeScript** core → type-safe clients for **Node, Bun, Tauri, React Native, Lynx, Vite, and Next.js** — compiled by [Vercel scriptc](https://scriptc.dev) to WASM (and optionally native `.lib.a`), with CI contracts that block breaking API changes.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Inspired by [rustra](https://github.com/loopy-lim/rustra) (Rust core → multi-host clients). scriptca swaps the Rust core for **scriptc**: you write ordinary TypeScript, scriptc compiles it, scriptca generates bindings and adapters.

## 5-minute quickstart

**Requirements:** Node.js ≥ 24, [zig 0.13.x](https://ziglang.org/download/) on `PATH` (for WASM). On Linux, `clang` if you want native `.lib.a`.

```bash
# from this monorepo after pnpm install && pnpm build
pnpm --filter @scriptca/cli exec scriptca init my-app
# or once published: npx @scriptca/cli init my-app

cd my-app
npm install
npx scriptca doctor
npx scriptca build
npm start
```

Edit `src/core.ts` and declare exports in `scriptca.json`, then rebuild.

## How it works

```
TypeScript core  →  scriptc library (WASM / .lib.a)  →  generated clients + adapters
```

1. You declare the ABI surface in `scriptca.json` (export names + param/return classes).
2. `scriptca build` writes a scriptc [library profile](https://scriptc.dev/docs/wasm), compiles with `scriptc build --lib`, and generates typed clients.
3. Adapters load the WASM reactor via WASI (Node/Bun) or a browser WASI polyfill (Vite/Tauri webview/Lynx).

Default artifact is **WASM** so you don't need a C linker for day-to-day use.

## Packages

| Package | Role |
|---------|------|
| `@scriptca/cli` | `init` / `build` / `diff` / `doctor` |
| `@scriptca/core` | profile, toolchain, WASM loader, contract hash, codegen |
| `@scriptca/types` | shared types / errors |
| `@scriptca/node` | Node WASI adapter |
| `@scriptca/bun` | Bun adapter |
| `@scriptca/tauri` | Tauri webview WASM + sidecar IPC |
| `@scriptca/react-native` | RN bridge (mock + host bridge) |
| `@scriptca/lynx` | Lynx + Rspeedy helpers |
| `@scriptca/vite` | Vite plugin (build + HMR rebuild) |
| `@scriptca/next` | Next.js webpack plugin + Turbopack `scriptcaBuild()` |
| `@scriptca/webpack` | Webpack / Rspack / Rsbuild plugin |
| `@scriptca/testing` | contract assert helpers |

## Adapter quickstarts

### Node

```bash
pnpm --filter @scriptca/example-calculator-core build
pnpm --filter @scriptca/example-node-app start
```

```ts
import { createNodeEngineFromOutDir } from '@scriptca/node';
const engine = await createNodeEngineFromOutDir('.scriptca');
engine.call('add', 20, 22); // 42
```

### Bun

```bash
pnpm --filter @scriptca/example-bun-app start
```

### Vite

```ts
// vite.config.ts
import scriptca from '@scriptca/vite';
export default { plugins: [scriptca()] };
```

### Next.js / Turbopack

```js
// next.config.mjs — webpack path
import { withScriptca } from '@scriptca/next';
export default withScriptca({});

// Turbopack: npm script predev → scriptcaBuild()
import { scriptcaBuild } from '@scriptca/next';
await scriptcaBuild();
```

### Tauri

```ts
import { createTauriSidecarEngine } from '@scriptca/tauri';
const engine = createTauriSidecarEngine({ invoke, profile });
```

Or load WASM in the webview (`scriptca build --hosts tauri`).

### React Native

```ts
import { createReactNativeEngine, createMockBridge } from '@scriptca/react-native';
const engine = createReactNativeEngine(createMockBridge({ add: (a, b) => a + b }));
```

Native linking of scriptc iOS/Android archives is documented by scriptc; not fully verified in this repo yet.

### Lynx

Use `@scriptca/webpack`'s `ScriptcaRspackPlugin` inside Rspeedy/Rsbuild, and `scriptca build --hosts lynx`.

## Contract gate (CI)

```bash
scriptca build                 # writes .scriptca/contract.json
# …change API…
scriptca diff --fail-on-breaking   # exit 1 on removals / signature changes
```

## Monorepo scripts

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @scriptca/example-node-app start
pnpm --filter @scriptca/example-bun-app start
```

## Limitations (from scriptc)

- Core TypeScript must stay within [scriptc's supported subset](https://scriptc.dev/docs/limitations) (library mode is static-only).
- Outbound native FFI is for **executables**, not libraries; hosts call **into** your library exports.
- String/bytes returns use scriptc's result arena (copied by the loader).
- zig **0.13.x** is required for WASM with scriptc 0.3.x (0.14 WASI libc assertion fails).
- Browser / Lynx / Tauri webview need a WASI Preview 1 polyfill for full execution.

## License

MIT
