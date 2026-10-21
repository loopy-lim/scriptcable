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

The `browser` flavor resolves its WASM automatically: it probes the module-relative location first (works wherever the bundler serves project files, e.g. `vite dev`), then the origin root — the Vite / Next.js / Webpack plugins copy `<name>.wasm` into your static directory (`public/`) on every build, so `createClient()` works in client graphs with no manual copy step. An explicit `createClient({ wasmUrl })` always wins (e.g. behind a base path or on a CDN). Server code needs nothing — the node flavor loads the shared library automatically.

Explicit subpaths pin a flavor: `@scriptcable/client/node`, `/bun`, `/browser`, `/react-native`, `/lynx`, `/tauri`. Editors resolve the same package, so TypeScript works with no `paths` config. The bundler plugins run the same emit: `withScriptcable` (which also adds `transpilePackages` for you) and the Webpack/Rspack plugin link the package during `next dev` / `next build`; on Turbopack, the predev `scriptcableBuild()` call does it.

If the link is missing — a fresh checkout before the first build — `scriptcable doctor` reports and repairs it. `scriptcable init` scaffolds CI durability out of the box: it records `"@scriptcable/client": "file:.scriptcable/generated"` in your dependencies together with a placeholder manifest and the gitignore negations that keep `bun install` working before the first build. For projects not created by `init`, `doctor` prints the exact snippet.

### Zero changes: the drop-in

With a bundler plugin registered, you don't even need the import above. The plugins redirect module imports that resolve to your core entry onto a generated **drop-in client** — same export names, parameter names, and JSDoc as your source — so existing code keeps reading `./core` while the bundle runs the compiled library:

```ts
// unchanged app code — the plugin swaps the module behind this import
import { add } from './src/core';
add(20, 22); // 42, native-addon speed
```

| Host | How interception wires up | Verified against |
|---|---|---|
| **Vite** | automatic — `resolveId` (runs before the builtin resolver) | Vite 6 dev + build (2026-10-21) |
| **Webpack** | automatic — an `enhanced-resolve` plugin | webpack plugin tests + Next's webpack graph (below) |
| **Next.js (webpack)** | automatic — client graphs get the browser drop-in, server/edge graphs the node one | Next 16.4.2 `next build --webpack` + `next start` runtime call (2026-10-21) |
| **Next.js (Turbopack)** | entry drop-in unavailable — Turbopack has no per-graph resolve hook, and `resolveAlias` matches request specifiers, not resolved paths (an absolute-path key does nothing — verified). Use `@scriptcable/client` (export conditions work via `transpilePackages`), or run `next dev/build --webpack` for drop-in imports | Next 16.4.2 turbopack build |
| **Rspack / Rspeedy (Lynx)** | Rspack's Rust resolver has no JS resolve-plugin hooks (`resolve.plugins` is not in its config schema — a pushed plugin is silently ignored). The plugin still runs the build and links the package; imports resolve through `@scriptcable/client` export conditions | Rspeedy 0.18.2 build (browser client in the bundle) |
| **React Native (Metro)** | `withScriptcableMetro()` from `@scriptcable/react-native/metro` in `metro.config.js` | Metro 0.87 / RN 0.88 real bundle (2026-10-21) |
| **Electron** | main process: `import { createClient } from '@scriptcable/client'` (node conditions); renderer: the Vite/Webpack plugin as usual | — |

Drop-in flavors: browser graphs initialize WASM once at module load (top-level await — build for **ES2022+**, e.g. vite `build.target: 'es2022'`); server graphs are **await-free** (`createClientSync()` — safe in CommonJS-output server bundles); Metro creates the bridge client lazily on first call.

Accuracy comes first: if your entry exports anything a drop-in can't provide — a non-function value, a class, a `default`/re-export, a function with unmappable types, or an `exports` list that pins a subset — that project is **not** intercepted and one warning line says why. Opt out entirely with `dropin: false` (Vite) / `dropin: false` (Webpack) / `{ dropin: false }` (`withScriptcable`).

### Before → after: what you stop knowing

Using scriptcable used to require seven pieces of knowledge; now it requires one — running `scriptcable build`, or registering a bundler plugin that runs it:

| You had to know | Before | Now |
| --- | --- | --- |
| Config file | `scriptcable.config.ts` required (`name`, `entry`) | optional — inferred from `package.json` + standard locations |
| Generated artifact paths | relative imports into `.scriptcable/generated/`, `outDir` option | nothing — one bare specifier, or none at all (drop-in) |
| Flavor selection | per-host adapter/file choice | automatic per environment (export conditions) |
| Browser WASI adapter | construct & pass `createMinimalWasi()` | `createClient()` takes no args |
| Bundler wiring | manual alias/transpile (Next), JSON-only plugin config | plugins wire everything |
| Editor types | manual tsconfig `paths` | real package — resolved as-is |
| **Call sites** | rewrite to `createClient()` + method calls | **unchanged** — plugins redirect `./core` imports onto the compiled client |

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
export default {
  plugins: [scriptcable()], // imports of ./core resolve to the compiled client
  build: { target: 'es2022' }, // drop-in browser client uses top-level await
};
```

Run vite with `bun --bun vite` so toolchain checks use the Bun runtime.

### Next.js

```js
// next.config.mjs — webpack path (drop-in per graph: client → browser, server → node)
import { withScriptcable } from '@scriptcable/next';
export default withScriptcable({});
// run `next build --webpack` / `next dev` for drop-in imports
```

Turbopack (Next 16's default bundler) has no per-graph resolve hook, and its
`resolveAlias` matches request specifiers rather than resolved paths — an
absolute-path alias key does nothing (verified against 16.4.2: the TypeScript
entry stayed in the graph). There is no silent pretend-alias: `withScriptcableAsync()`
prints that once and leaves the imports alone. App code imports
`@scriptcable/client`; export conditions still deliver the compiled client in
both graphs:

```js
// next.config.mjs — Turbopack path
import { withScriptcableAsync } from '@scriptcable/next';
export default await withScriptcableAsync({}); // builds artifacts + links @scriptcable/client
```

### Tauri

```ts
import { createTauriSidecarEngine } from '@scriptcable/tauri';
const engine = createTauriSidecarEngine({ invoke, profile });
```

In the Tauri Rust shell, link `scriptcable build`'s `lib{name}.a` (build script / `cc`) and wrap the C ABI symbols with `#[tauri::command]`. A Tauri v2 frontend built with Vite gets the drop-in browser client from the Vite plugin like any web app.

### Electron

No new package needed — Electron is two scriptcable hosts:

```ts
// main process (Node runtime) — one import, export conditions pick the
// native node flavor; calls are synchronous
import { createClient } from '@scriptcable/client';
const client = await createClient();
client.add(20, 22); // 42

// renderer (built with vite or webpack) — register the plugin as usual and
// imports of ./core resolve to the browser drop-in, same as any web app
```

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

// 3. Drop-in — metro.config.js: imports of ./core resolve to the compiled
//    client (keep `scriptcable build --watch` running alongside Metro)
import { withScriptcableMetro } from '@scriptcable/react-native/metro';
export default withScriptcableMetro(getDefaultConfig(__dirname));
```

On device, TurboModule drop-in calls resolve as Promises — same semantics as the bridge client above.

`scriptcable build --hosts react-native` also emits `NativeCable.ts` (TurboModule spec) and `cable.json` (RN CLI codegen config). Link the iOS/Android archives in your Expo module (Xcode / NDK CMake) — see `packages/react-native/README.md` for the full recipe and `examples/react-native-app` for the `useCable` hook pattern with automatic mock fallback.

### Lynx

Use `@scriptcable/webpack`'s `ScriptcableRspackPlugin` inside Rspeedy/Rsbuild, and `scriptcable build --hosts lynx`.

## Watch mode

For hosts without their own watcher (Next.js on Turbopack via a predev script, plain Bun/Node apps):

```bash
scriptcable build --watch
```

It watches the same inputs the build cache hashes — your core entry, its same-directory siblings, and the config files — and rebuilds (codegen and the `@scriptcable/client` link included) when they change. Errors don't kill the watcher: fix the file and it rebuilds.

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
- The **browser drop-in** initializes WASM with top-level await — build for **ES2022+** (Chrome 89+, Safari 15+, Firefox 89+). On stricter targets use `dropin: false` and the async `createClient()`.
- **Drop-in interception** applies only when the entry's entire runtime export surface is ABI-mappable (named functions); anything else disables it with a printed reason.
- **Drop-in host matrix** (verified 2026-10-21): Vite 6, Next 16 webpack graph (build + runtime), Metro 0.87 / RN 0.88, Rspeedy 0.18 (conditions path) — end-to-end. Turbopack: entry drop-in unavailable (no resolve hook; see the host table). Lynx/TurboModule **on-device** call semantics remain unverified — no device in the loop.
- Bundler plugins compile inside the host's build process, so any Node version is accepted there (`doctorRuntimeGate: 'skip'`); the Node ≥ 24 floor applies to running the CLI / generated clients directly.

## License

MIT
