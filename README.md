English | [Korean](./README.ko.md)

# scriptcable

One **TypeScript** core → type-safe clients for **Bun, Node, Tauri, React Native, Lynx, Vite, and Next.js** — compiled by [Vercel scriptc](https://scriptc.dev) to a **native** library by default (`.lib.a` → `.so`/`.dylib`/`.dll`), with WASM as an opt-in fallback for browsers, with CI contracts that block breaking API changes.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Inspired by [rustra](https://github.com/loopy-lim/rustra) (Rust core → multi-host clients). scriptcable swaps the Rust core for **scriptc**: you write ordinary TypeScript, scriptc compiles it, scriptcable generates bindings and adapters. **Everything here — tooling and apps — runs on [Bun](https://bun.sh).**

## 5-minute quickstart

**Requirements:** Bun ≥ 1.2 and `clang` (links the native shared library). Optional: [zig 0.13.x](https://ziglang.org/download/) only if you build `--target wasm`.

**Every command below is verified end-to-end — with the output you should see at each step — in [docs/getting-started.md](./docs/getting-started.md).** Stuck? [docs/troubleshooting.md](./docs/troubleshooting.md) lists real errors and their fixes.

```bash
# from this monorepo after bun install && bun run build
bun packages/cli/dist/index.js init demo --host bun --from .
# or once published: bunx @scriptcable/cli init demo --host bun

cd demo
bun install
bun run doctor && bun run build && bun start
# → {"sum":42,"hi":"hello, bun"}
```

`init` scaffolds a typed `scriptcable.config.ts` (preferred) or `scriptcable.json`. **You never declare exports by hand** — they're inferred from your `src/core.ts` types (see below).

## Zero-config

You don't need a config file at all. With `package.json` and a core at a standard location, this just works:

```bash
bunx scriptcable build          # name from package.json, entry from src/core.ts
```

Everything is inferred, in priority order (explicit config > inference):

| Field | Inferred from |
|-------|---------------|
| `exports` | TS types of the entry's exported functions |
| `name` | `package.json` `name` (scoped `@scope/my-pkg` → `scope_my_pkg`), else the directory name |
| `entry` | first of `src/core.ts`, `core.ts`, `src/index.ts`, `index.ts` |
| `prefix` | `name` + `_` |
| `outDir` | `.scriptcable` |
| `target` | `native` (WASM opt-in) |

A config file only pins what you want to override — `name` and `entry` are optional there too:

```ts
// scriptcable.config.ts — everything optional
import { defineConfig } from '@scriptcable/core';
export default defineConfig({});            // all inferred
export default defineConfig({ name: 'mycore' }); // entry still inferred
```

The Vite / Next.js / Webpack plugins use the same resolution (including `scriptcable.config.ts`), and adapters default to `.scriptcable`:

```ts
import { createBunEngineFromOutDir } from '@scriptcable/bun';
const engine = await createBunEngineFromOutDir(); // → ./.scriptcable
```

## One import: `@scriptcable/client`

Every build publishes the generated clients as a **real package**: `scriptcable build` writes a package manifest into `.scriptcable/generated/` and links it as `node_modules/@scriptcable/client`. App code never references `.scriptcable/` paths:

```ts
import { createClient } from '@scriptcable/client';

const client = await createClient();
client.add(20, 22); // 42
```

Export conditions resolve the right flavor per environment — no branching in your code:

| Environment | Flavor |
|---|---|
| Bun runtime | `bun.ts` (bun:ffi native) |
| Node runtime — Next server components, route handlers, server actions | `node.ts` (native shared lib, WASM fallback) |
| Browser bundles served from project files (e.g. `vite dev`) | `browser.ts` (WASM — a minimal WASI polyfill is built in, so no-arg works) |
| Metro (React Native) | `react-native.ts` (bridge-based) |

The `browser` flavor fetches the WASM next to the generated module, which works where the bundler serves project files (`vite dev`). In Next.js client graphs, copy `<name>.wasm` to your static directory and call `createClient({ wasmUrl: '/<name>.wasm' })` — server code needs nothing, the node flavor loads the shared library automatically.

Explicit subpaths pin a flavor: `@scriptcable/client/node`, `/bun`, `/browser`, `/react-native`, `/lynx`, `/tauri`. Editors resolve the same package, so TypeScript works with no `paths` config. The bundler plugins run the same emit: `withScriptcable` (which also adds `transpilePackages` for you) and the Webpack/Rspack plugin link the package during `next dev` / `next build`; on Turbopack, the predev `scriptcableBuild()` call does it.

If the link is missing — a fresh checkout before the first build — `scriptcable doctor` reports and repairs it. For CI durability, add `"@scriptcable/client": "file:.scriptcable/generated"` to your dependencies.

### Before → after: what you stop knowing

Using scriptcable used to require seven pieces of knowledge; now it requires one (`scriptcable build`, or a bundler plugin to run it):

| You had to know | Before | Now |
| --- | --- | --- |
| Config file | `scriptcable.config.ts` required (`name`, `entry`) | optional — inferred from `package.json` + standard locations |
| Generated artifact paths | relative imports into `.scriptcable/generated/`, `outDir` option | nothing — one bare specifier |
| Flavor selection | per-host adapter/file choice | automatic per environment (export conditions) |
| Browser WASI adapter | construct & pass `createMinimalWasi()` | `createClient()` takes no args |
| Bundler wiring | manual alias/transpile (Next), JSON-only plugin config | plugins wire everything |
| Editor types | manual tsconfig `paths` | real package — resolved as-is |

```ts
// before — per-host imports, paths, adapters
const engine = await createNodeEngine({ outDir: '.scriptcable' });

// after — identical in Bun, Node, Next server code, and the browser
import { createClient } from '@scriptcable/client';
const client = await createClient();
```

There is no speed trade-off for the convenience: calls run at the measured engine speed everywhere (see [BENCHMARK.md](./BENCHMARK.md) — ~73 ns native/WASM, 48 ns browser WASM, sub-µs RN bridge hop).

## How it works

```
TypeScript core  →  scriptc library (WASM / .lib.a)  →  generated clients + adapters
```

1. **Zero-duplication ABI**: `scriptcable build` parses `src/core.ts` with the TS compiler API and infers every ABI-mappable exported function — names, parameter names, JSDoc, and types (`number`→`f64`, `string`, `boolean`→`bool`, `Uint8Array`→`bytes`). Functions with unmappable types are skipped with a printed reason. scriptc 0.3.x marshals only f64/u8/u32/i32 at the TS level — in practice cores use `number`/`string`/`boolean`/`Uint8Array`; wider integers (`i64`/`u64`) arrive when scriptc exposes them.
2. `scriptcable build` writes a scriptc library profile, compiles with `scriptc build --lib` to a **native** `.lib.a`, links a loadable shared library, and generates typed clients that keep your parameter names and JSDoc.
3. Bun loads via **bun:ffi** (built-in — no extra dependency). Plain Node can optionally load via koffi. Tauri / React Native / Lynx link the archive natively. Browser UIs opt into WASM.

Default artifact is **native**. Use `"target": "wasm"` or `scriptcable build --target wasm` only where native cannot run (browsers).

### Config: `scriptcable.config.ts` (typed, recommended)

```ts
import { defineConfig } from '@scriptcable/core';

export default defineConfig({
  name: 'mycore',   // optional — inferred from package.json
  entry: 'src/core.ts', // optional — inferred from standard locations
  // exports: inferred — add an explicit array only to pin/subset the surface
});
```

JSON (`scriptcable.json`) still works for zero-dependency setups, and omitting config entirely works too (see [Zero-config](#zero-config)). The TS config wins when both exist.

## Packages

| Package | Role |
|---------|------|
| `@scriptcable/cli` | `init` / `build` / `diff` / `doctor` |
| `@scriptcable/core` | profile, toolchain, WASM loader, contract hash, codegen |
| `@scriptcable/types` | shared types / errors |
| `@scriptcable/node` | Node adapter (native shared library; koffi optional) |
| `@scriptcable/bun` | Bun adapter (bun:ffi native by default) |
| `@scriptcable/tauri` | Tauri invoke bridge |
| `@scriptcable/react-native` | RN bridge (mock + host bridge) |
| `@scriptcable/lynx` | Lynx + Rspeedy helpers |
| `@scriptcable/vite` | Vite plugin (build + HMR rebuild) |
| `@scriptcable/next` | Next.js webpack plugin + Turbopack `scriptcableBuild()` |
| `@scriptcable/webpack` | Webpack / Rspack / Rsbuild plugin |
| `@scriptcable/testing` | contract assert helpers |

## Adapter quickstarts

### Bun

```bash
bun run --filter @scriptcable/example-calculator-core build
bun run --filter @scriptcable/example-bun-app start
```

```ts
import { createBunEngineFromOutDir } from '@scriptcable/bun';
const engine = await createBunEngineFromOutDir('.scriptcable');
engine.call('add', 20, 22); // 42  (native .dylib via bun:ffi)
```

### Node

```bash
bun run --filter @scriptcable/example-node-app start
```

Under Bun (default), native loading uses built-in `bun:ffi`. Under plain Node, install `koffi` as an optional fallback.

### Vite

```ts
// vite.config.ts
import scriptcable from '@scriptcable/vite';
export default { plugins: [scriptcable()] };
```

Run vite with `bun --bun vite` so toolchain checks use the Bun runtime.

### Next.js / Turbopack

```js
// next.config.mjs — webpack path
import { withScriptca } from '@scriptcable/next';
export default withScriptca({});

// Turbopack: predev script → scriptcableBuild()
import { scriptcableBuild } from '@scriptcable/next';
await scriptcableBuild();
```

### Tauri

```ts
import { createTauriSidecarEngine } from '@scriptcable/tauri';
const engine = createTauriSidecarEngine({ invoke, profile });
```

In the Tauri Rust shell, link `scriptcable build`'s `lib{name}.a` (build script / `cc`) and wrap the C ABI symbols with `#[tauri::command]`.

### React Native

```ts
// 1. Tests / Storybook — no device needed
import { createReactNativeEngine, createMockBridge } from '@scriptcable/react-native';
const engine = createReactNativeEngine(createMockBridge({ add: (a, b) => a + b }));

// 2. Device — TurboModule (spec generated by `scriptcable build --hosts react-native`)
import { createTurboModuleBridge } from '@scriptcable/react-native';
import NativeCable from '../.scriptcable/generated/NativeCable';
const engine = createReactNativeEngine(createTurboModuleBridge(NativeCable));
await engine.invoke('add', [20, 22]); // 42
```

`scriptcable build --hosts react-native` also emits `NativeCable.ts` (TurboModule spec) and `cable.json` (RN CLI codegen config). Link the iOS/Android archives in your Expo module (Xcode / NDK CMake) — see `packages/react-native/README.md` for the full recipe and `examples/react-native-app` for the `useCable` hook pattern with automatic mock fallback.

### Lynx

Use `@scriptcable/webpack`'s `ScriptcableRspackPlugin` inside Rspeedy/Rsbuild, and `scriptcable build --hosts lynx`.

## Contract gate (CI)

```bash
scriptcable build                 # writes .scriptcable/contract.json
# …change API…
scriptcable diff --fail-on-breaking   # exit 1 on removals / signature changes
```

## Performance

Benchmarks live in `examples/bench-core` (`bun run bench`): native (typed N-API addon / FFI) vs wasm (WASI) call latency/throughput plus cold/warm build times. Headline numbers on an M1 Max: **~24.5 ns/call** via the generated typed N-API addon on Node (~47 ns on Bun, still ahead of bun:ffi), 48 ns browser WASM, cold core build **~1.1 s**, warm (cached) **~166 ms** — **6.4× faster**. The `@scriptcable/client` package adds no call-path cost (flavor selection is import-time resolution). See [BENCHMARK.md](./BENCHMARK.md).

Repeat builds are cached automatically — `scriptcable build --force` bypasses the cache.

## Monorepo scripts

```bash
bun install
bun run build
bun run test
bun run --filter @scriptcable/example-bun-app start
bun run --filter @scriptcable/example-node-app start
```

Note: `scriptc` must be a trusted dependency so Bun runs its install script (already configured in the root `package.json`).

## Limitations (from scriptc)

- Core TypeScript must stay within [scriptc's supported subset](https://scriptc.dev/docs/limitations) (library mode is static-only).
- Hosts call **into** your library exports (C ABI); outbound FFI is for scriptc executables, not libraries.
- String/bytes use `(ptr, len)` in / `(out_ptr, out_len)` out on the native boundary.
- **clang** is required for the default native shared-library link.
- WASM (`--target wasm`) still needs zig **0.13.x** with scriptc 0.3.x, plus a WASI polyfill in browsers.

## License

MIT
