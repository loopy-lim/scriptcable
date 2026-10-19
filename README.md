English | [Korean](./README.ko.md)

# scriptca

One **TypeScript** core → type-safe clients for **Node, Bun, Tauri, React Native, Lynx, Vite, and Next.js** — compiled by [Vercel scriptc](https://scriptc.dev) to a **native** library by default (`.lib.a` → `.so`/`.dylib`/`.dll`), with WASM as an opt-in fallback for browsers, with CI contracts that block breaking API changes.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Inspired by [rustra](https://github.com/loopy-lim/rustra) (Rust core → multi-host clients). scriptca swaps the Rust core for **scriptc**: you write ordinary TypeScript, scriptc compiles it, scriptca generates bindings and adapters.

## 5-minute quickstart

**Requirements:** Node.js ≥ 24 and `clang` (links the native shared library). Optional: [zig 0.13.x](https://ziglang.org/download/) only if you build `--target wasm`.

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
2. `scriptca build` writes a scriptc library profile, compiles with `scriptc build --lib` to a **native** `.lib.a`, links a loadable shared library, and generates typed clients.
3. Node loads via **koffi**; Bun via **bun:ffi**. Tauri / React Native / Lynx link the archive natively. Browser UIs opt into WASM.

Default artifact is **native**. Use `"target": "wasm"` or `scriptca build --target wasm` only where native cannot run (browsers).

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
import { createNodeEngine } from '@scriptca/node';
const engine = await createNodeEngine({ outDir: '.scriptca' });
engine.call('add', 20, 22); // 42  (native .so via koffi)
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
- Hosts call **into** your library exports (C ABI); outbound FFI is for scriptc executables, not libraries.
- String/bytes use `(ptr, len)` in / `(out_ptr, out_len)` out on the native boundary.
- **clang** is required for the default native shared-library link.
- WASM (`--target wasm`) still needs zig **0.13.x** with scriptc 0.3.x, plus a WASI polyfill in browsers.

## License

MIT
