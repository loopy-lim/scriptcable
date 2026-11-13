English | [Korean](./README.ko.md)

# scriptca

One **TypeScript** core → type-safe clients for **Bun, Node, Tauri, React Native, Lynx, Vite, and Next.js** — compiled by [Vercel scriptc](https://scriptc.dev) to a **native** library by default (`.lib.a` → `.so`/`.dylib`/`.dll`), with WASM as an opt-in fallback for browsers, with CI contracts that block breaking API changes.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Inspired by [rustra](https://github.com/loopy-lim/rustra) (Rust core → multi-host clients). scriptca swaps the Rust core for **scriptc**: you write ordinary TypeScript, scriptc compiles it, scriptca generates bindings and adapters. **Everything here — tooling and apps — runs on [Bun](https://bun.sh).**

## 5-minute quickstart

**Requirements:** Bun ≥ 1.2 and `clang` (or gcc's `cc`) to link the native shared library. Optional: [zig 0.13.x](https://ziglang.org/download/) only if you build `--target wasm` — and if it's not installed, the first wasm/cross build **auto-provisions** it into your user cache (`SCRIPTCA_NO_AUTO_TOOLS=1` opts out). The provisioned `zig cc` also links host builds when clang and `cc` are both absent.

**Every command below is verified end-to-end — with the output you should see at each step — in [docs/getting-started.md](./docs/getting-started.md).** Stuck? [docs/troubleshooting.md](./docs/troubleshooting.md) lists real errors and their fixes.

```bash
# from this monorepo after bun install && bun run build
bun packages/cli/dist/index.js init demo --host bun --from .
# or once published: bunx @unikit-bridge/scriptca init demo --host bun

cd demo
bun install
bun run doctor && bun run build && bun start
# → {"sum":42,"hi":"hello, bun"}
```

`init` scaffolds a typed `scriptca.config.ts` (preferred) or `scriptca.json`. **You never declare exports by hand** — they're inferred from your `src/core.ts` types (see below).

## Zero-config

You don't need a config file at all. With `package.json` and a core at a standard location, this just works:

```bash
bunx scriptca build          # name from package.json, entry from src/core.ts
```

Everything is inferred, in priority order (explicit config > inference):

| Field | Inferred from |
|-------|---------------|
| `exports` | TS types of the entry's exported functions |
| `name` | `package.json` `name` (scoped `@scope/my-pkg` → `scope_my_pkg`), else the directory name |
| `entry` | first of `src/core.ts`, `core.ts`, `src/index.ts`, `index.ts` |
| `prefix` | `name` + `_` |
| `outDir` | `.scriptca` |
| `target` | `native` (WASM opt-in) |

A config file only pins what you want to override — `name` and `entry` are optional there too:

```ts
// scriptca.config.ts — everything optional
import { defineConfig } from '@unikit-bridge/scriptca/core';
export default defineConfig({});            // all inferred
export default defineConfig({ name: 'mycore' }); // entry still inferred
```

The Vite / Next.js / Webpack plugins use the same resolution (including `scriptca.config.ts`), and adapters default to `.scriptca`:

```ts
import { createBunEngineFromOutDir } from '@unikit-bridge/scriptca/bun';
const engine = await createBunEngineFromOutDir(); // → ./.scriptca
```

## One import: `@unikit-bridge/scriptca-client`

Every build publishes the generated clients as a **real package**: `scriptca build` writes a package manifest into `.scriptca/generated/` and links it as `node_modules/@unikit-bridge/scriptca-client`. App code never references `.scriptca/` paths:

```ts
import { createClient } from '@unikit-bridge/scriptca-client';

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
| Deno runtime | `deno.ts` (compiled `.js` — Deno won't strip types under `node_modules`; the WASM is read from the generated directory) |
| Cloudflare Workers | `workers.ts` (`workerd` condition — the wasm rides a static CompiledWasm import through wrangler) |

The `browser` flavor resolves its WASM automatically: it probes the module-relative location first (works wherever the bundler serves project files, e.g. `vite dev`), then the origin root — the Vite / Next.js / Webpack plugins copy `<name>.wasm` into your static directory (`public/`) on every build, so `createClient()` works in client graphs with no manual copy step. An explicit `createClient({ wasmUrl })` always wins (e.g. behind a base path or on a CDN). Server code needs nothing — the node flavor loads the shared library automatically.

Explicit subpaths pin a flavor: `@unikit-bridge/scriptca-client/node`, `/bun`, `/browser`, `/react-native`, `/lynx`, `/tauri`, `/deno`, `/workerd`. Editors resolve the same package, so TypeScript works with no `paths` config. The bundler plugins run the same emit: `withScriptca` (which also adds `transpilePackages` for you) and the Webpack/Rspack plugin link the package during `next dev` / `next build`; on Turbopack, the predev `scriptcaBuild()` call does it.

If the link is missing — a fresh checkout before the first build — `scriptca doctor` reports and repairs it. `scriptca init` scaffolds CI durability out of the box: it records `"@unikit-bridge/scriptca-client": "file:.scriptca/generated"` in your dependencies together with a placeholder manifest and the gitignore negations that keep `bun install` working before the first build. For projects not created by `init`, `doctor` prints the exact snippet.

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
| **Next.js (Turbopack)** | entry drop-in unavailable — Turbopack has no per-graph resolve hook, and `resolveAlias` matches request specifiers, not resolved paths (an absolute-path key does nothing — verified). Use `@unikit-bridge/scriptca-client` (export conditions work via `transpilePackages`), or run `next dev/build --webpack` for drop-in imports | Next 16.4.2 turbopack build |
| **Rspack / Rspeedy (Lynx)** | Rspack's Rust resolver has no JS resolve-plugin hooks (`resolve.plugins` is not in its config schema — a pushed plugin is silently ignored). The plugin still runs the build and links the package; imports resolve through `@unikit-bridge/scriptca-client` export conditions | Rspeedy 0.18.2 build (browser client in the bundle) |
| **React Native (Metro)** | `withScriptcaMetro()` from `@unikit-bridge/scriptca/react-native/metro` in `metro.config.js` | Metro 0.87 / RN 0.88 real bundle (2026-10-21) |
| **Expo** | same `withScriptcaMetro()` — Expo's bundler IS Metro; register it over `@expo/metro-config`'s default config (`app.json`/`metro.config.js`) | Expo 58 real metro config (`getDefaultConfig`) bundle — drop-in bridge in, entry source out (2026-10-22) |
| **Electron** | main process: `import { createClient } from '@unikit-bridge/scriptca-client'` (node conditions — the generated package ships compiled `.js` for the runtime flavors, since Electron's Node can't load `.ts`); renderer: the Vite/Webpack plugin as usual | Electron 33 real runtime: main calls the native core, the vite-built renderer calls the WASM drop-in over a custom protocol (2026-10-22) |
| **Astro / SvelteKit / Nuxt / Remix (React Router) / SolidStart** | all embed Vite — register `@unikit-bridge/scriptca/vite` in their `vite.plugins`. Nuxt 4 moves vite's root to its `srcDir`, so pass the project root explicitly: `scriptca({ root: import.meta.dirname })` | Astro 5.18, SvelteKit 2, Nuxt 4.6, React Router 8.5 (SPA mode), SolidStart 2.0 (`@solidjs/start` + vite 8) — real builds: drop-in in the client bundle, WASM shipped as a static asset (2026-10-22) |
| **Rollup** | same plugin (`root` option) — `resolveId` is standard rollup hook shape; TypeScript transforms + `.js`→`.ts` sibling resolution are the host's job (pair with your ts/esbuild plugins) | rollup 4 real build — entry import redirected onto the drop-in (2026-10-22) |
| **Deno** | no plugin — export conditions resolve the `deno` flavor (emitted as compiled `.js`, placed **ahead of `node`** in the manifest because Deno turns the `node` condition on itself); `scriptca build --target wasm --hosts deno` first (the codegen CLI runs on Bun) | Deno 2.9 real runtime — bare `@unikit-bridge/scriptca-client` import + `deno run -A`, no flags or config (2026-10-22) |
| **Cloudflare Workers** | no plugin — wrangler resolves bundles with the `workerd` condition; the workers flavor statically imports the wasm (wrangler's default CompiledWasm rule), so no fetch and no top-level await | wrangler 4.151 — dry-run bundle + a real `wrangler dev` (workerd) HTTP call returning 42 (2026-10-22) |

Drop-in flavors: browser graphs initialize WASM once at module load (top-level await — build for **ES2022+**, e.g. vite `build.target: 'es2022'`); server graphs are **await-free** (`createClientSync()` — safe in CommonJS-output server bundles); Metro creates the bridge client lazily on first call.

Accuracy comes first: if your entry exports anything a drop-in can't provide — a non-function value, a class, a `default`/re-export, a function with unmappable types, or an `exports` list that pins a subset — that project is **not** intercepted and one warning line says why. Opt out entirely with `dropin: false` (Vite) / `dropin: false` (Webpack) / `{ dropin: false }` (`withScriptca`).

### Before → after: what you stop knowing

Using scriptca used to require seven pieces of knowledge; now it requires one — running `scriptca build`, or registering a bundler plugin that runs it:

| You had to know | Before | Now |
| --- | --- | --- |
| Config file | `scriptca.config.ts` required (`name`, `entry`) | optional — inferred from `package.json` + standard locations |
| Generated artifact paths | relative imports into `.scriptca/generated/`, `outDir` option | nothing — one bare specifier, or none at all (drop-in) |
| Flavor selection | per-host adapter/file choice | automatic per environment (export conditions) |
| Browser WASI adapter | construct & pass `createMinimalWasi()` | `createClient()` takes no args |
| Bundler wiring | manual alias/transpile (Next), JSON-only plugin config | plugins wire everything |
| Editor types | manual tsconfig `paths` | real package — resolved as-is |
| **Call sites** | rewrite to `createClient()` + method calls | **unchanged** — plugins redirect `./core` imports onto the compiled client |

```ts
// before — per-host imports, paths, adapters
const engine = await createNodeEngine({ outDir: '.scriptca' });

// after — identical in Bun, Node, Next server code, and the browser
import { createClient } from '@unikit-bridge/scriptca-client';
const client = await createClient();
```

There is no speed trade-off for the convenience: calls run at the measured engine speed everywhere (see [BENCHMARK.md](./BENCHMARK.md) — ~73 ns native/WASM, 48 ns browser WASM, sub-µs RN bridge hop).

## How it works

```
TypeScript core  →  scriptc library (WASM / .lib.a)  →  generated clients + adapters
```

1. **Zero-duplication ABI**: `scriptca build` parses `src/core.ts` with the TS compiler API and infers every ABI-mappable exported function — names, parameter names, JSDoc, and types (`number`→`f64`, `string`, `boolean`→`bool`, `Uint8Array`→`bytes`). Functions with unmappable types are skipped with a printed reason. Cores use `number`/`string`/`boolean`/`Uint8Array`; **wider integers (`i64`/`u64`) work on scriptc ≥ 0.4** — declare them in `scriptca.json` (`"params": ["i64"]`) with the TS type `number`; scriptc proves the value range stays within ±(2^53 − 1) and refuses otherwise (SC4023). `bigint` stays unsupported — i64 rides float64 by design.
2. `scriptca build` writes a scriptc library profile, compiles with `scriptc build --lib` to a **native** `.lib.a`, links a loadable shared library, and generates typed clients that keep your parameter names and JSDoc.
3. Bun loads via **bun:ffi** (built-in — no extra dependency). Plain Node can optionally load via koffi. Tauri / React Native / Lynx link the archive natively. Browser UIs opt into WASM.

Default artifact is **native**. Use `"target": "wasm"` or `scriptca build --target wasm` only where native cannot run (browsers).

### Config: `scriptca.config.ts` (typed, recommended)

```ts
import { defineConfig } from '@unikit-bridge/scriptca/core';

export default defineConfig({
  name: 'mycore',   // optional — inferred from package.json
  entry: 'src/core.ts', // optional — inferred from standard locations
  // exports: inferred — add an explicit array only to pin/subset the surface
});
```

JSON (`scriptca.json`) still works for zero-dependency setups, and omitting config entirely works too (see [Zero-config](#zero-config)). The TS config wins when both exist.

## Package

Published as one package — **`@unikit-bridge/scriptca`** — with host/plugin subpaths (monorepo `@scriptca/*` packages stay private and are assembled into it):

| Subpath | Role |
|---------|------|
| `@unikit-bridge/scriptca` / `/core` | profile, toolchain, WASM loader, contract hash, codegen |
| `@unikit-bridge/scriptca/cli` | `init` / `build` / `diff` / `doctor` (also the `scriptca` bin) |
| `@unikit-bridge/scriptca/types` | shared types / errors |
| `@unikit-bridge/scriptca/node` | Node adapter (native shared library; koffi optional) |
| `@unikit-bridge/scriptca/bun` | Bun adapter (bun:ffi native by default) |
| `@unikit-bridge/scriptca/tauri` | Tauri invoke bridge |
| `@unikit-bridge/scriptca/react-native` | RN bridge (mock + host bridge) |
| `@unikit-bridge/scriptca/lynx` | Lynx + Rspeedy helpers |
| `@unikit-bridge/scriptca/vite` | Vite plugin (build + HMR rebuild) |
| `@unikit-bridge/scriptca/next` | Next.js webpack plugin + Turbopack `scriptcaBuild()` |
| `@unikit-bridge/scriptca/webpack` | Webpack / Rspack / Rsbuild plugin |
| `@unikit-bridge/scriptca/expo` | Expo config plugin |
| `@unikit-bridge/scriptca/testing` | contract assert helpers |

## Adapter quickstarts

### Bun

```bash
bun run --filter @scriptca/example-calculator-core build
bun run --filter @scriptca/example-bun-app start
```

```ts
import { createBunEngineFromOutDir } from '@unikit-bridge/scriptca/bun';
const engine = await createBunEngineFromOutDir('.scriptca');
engine.call('add', 20, 22); // 42  (native .dylib via bun:ffi)
```

### Node

```bash
bun run --filter @scriptca/example-node-app start
```

Under Bun (default), native loading uses built-in `bun:ffi`. Under plain Node, install `koffi` as an optional fallback.

### Vite

```ts
// vite.config.ts
import scriptca from '@unikit-bridge/scriptca/vite';
export default {
  plugins: [scriptca()], // imports of ./core resolve to the compiled client
  build: { target: 'es2022' }, // drop-in browser client uses top-level await
};
```

Run vite with `bun --bun vite` so toolchain checks use the Bun runtime.

### Next.js

```js
// next.config.mjs — webpack path (drop-in per graph: client → browser, server → node)
import { withScriptca } from '@unikit-bridge/scriptca/next';
export default withScriptca({});
// run `next build --webpack` / `next dev` for drop-in imports
```

Turbopack (Next 16's default bundler) has no per-graph resolve hook, and its
`resolveAlias` matches request specifiers rather than resolved paths — an
absolute-path alias key does nothing (verified against 16.4.2: the TypeScript
entry stayed in the graph). There is no silent pretend-alias: `withScriptcaAsync()`
prints that once and leaves the imports alone. App code imports
`@unikit-bridge/scriptca-client`; export conditions still deliver the compiled client in
both graphs:

```js
// next.config.mjs — Turbopack path
import { withScriptcaAsync } from '@unikit-bridge/scriptca/next';
export default await withScriptcaAsync({}); // builds artifacts + links @unikit-bridge/scriptca-client
```

### Astro (and other Vite-based frameworks)

Astro embeds Vite — register the plugin through its vite options (`examples/astro-app` is a verified `astro build` sample):

```js
// astro.config.mjs
import scriptca from '@unikit-bridge/scriptca/vite';
export default {
  vite: {
    plugins: [scriptca()],
    build: { target: 'es2022' }, // the drop-in browser init uses top-level await
  },
};
```

SvelteKit, Nuxt, Remix (React Router v7+) and SolidStart 2 embed Vite too — the same plugin goes beside their own vite plugin. All four are verified with real builds (`examples/sveltekit-app` — adapter-static + `ssr = false`; `examples/remix-app` — `ssr: false` SPA in `react-router.config.ts`; `examples/solidstart-app` — `solidStart()` from `@solidjs/start/config` + **vite 8+**, which SolidStart 2's peer range requires). Nuxt 4 is the one special case: it points vite's root at its `srcDir` (`app/`), so give the plugin the project root explicitly — everything else stays zero-config:

```ts
// nuxt.config.ts
import scriptca from '@unikit-bridge/scriptca/vite';
export default defineNuxtConfig({
  ssr: false,
  vite: {
    plugins: [scriptca({ root: import.meta.dirname })],
    build: { target: 'es2022' },
  },
});
```

### Deno and Cloudflare Workers

Both run the generated client with **no bundler plugin** — export conditions pick the flavor, the same one-import DX as every other runtime:

```bash
scriptca build --target wasm --hosts deno    # or --hosts workers
deno run -A src/main.ts                          # bare import of @unikit-bridge/scriptca-client inside
```

- **Deno** (`examples/deno-app`): the `deno` flavor is emitted as **compiled `.js`** — Deno refuses to strip types under `node_modules` — and the manifest lists the `deno` condition ahead of `node` (which Deno enables itself). The wasm is read directly from the generated directory, so there is no URL probing. Plain `deno run -A` — no flags, no `deno.json`.
- **Cloudflare Workers** (`examples/workers-app`): the `workerd` flavor statically imports the wasm — wrangler's default CompiledWasm rule hands the bundle the compiled module, so `createClient()` needs no fetch and no top-level await. Verified against a real `wrangler dev` (workerd) call.

One prerequisite for both: the codegen CLI itself runs on **Bun** (same as every host today) — run `scriptca build` in CI or your dev machine, then the generated client runs on Deno/workerd.

### Tauri

```ts
import { createTauriSidecarEngine } from '@unikit-bridge/scriptca/tauri';
const engine = createTauriSidecarEngine({ invoke, profile });
```

In the Tauri Rust shell, link `scriptca build`'s `lib{name}.a` (build script / `cc`) and wrap the C ABI symbols with `#[tauri::command]`. A Tauri v2 frontend built with Vite gets the drop-in browser client from the Vite plugin like any web app.

### Electron

No new package needed — Electron is two scriptca hosts (`examples/electron-app` is a verified end-to-end sample):

```ts
// main process (Node runtime) — one import, export conditions pick the
// native node flavor; calls are synchronous
import { createClient } from '@unikit-bridge/scriptca-client';
const client = await createClient();
client.add(20, 22); // 42

// renderer (built with vite or webpack) — register the plugin as usual and
// imports of ./core resolve to the browser drop-in, same as any web app
```

Two Electron-specific notes: the generated package's `bun`/`node` conditions point at **compiled `.js`** (Electron's Node 20 cannot load `.ts`, so the build emits both), and a renderer served from `dist/` needs a custom protocol — `protocol.registerSchemesAsPrivileged([{ scheme: 'scriptca', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])` before ready, then `protocol.handle('scriptca', …)` serving dist — so the WASM `fetch()` works.

### React Native

```ts
// 1. Tests / Storybook — no device needed
import { createReactNativeEngine, createMockBridge } from '@unikit-bridge/scriptca/react-native';
const engine = createReactNativeEngine(createMockBridge({ add: (a, b) => a + b }));

// 2. Device — TurboModule (spec generated by `scriptca build --hosts react-native`)
import { createTurboModuleBridge } from '@unikit-bridge/scriptca/react-native';
import NativeCable from '../.scriptca/generated/NativeCable';
const engine = createReactNativeEngine(createTurboModuleBridge(NativeCable));
await engine.invoke('add', [20, 22]); // 42

// 3. Drop-in — metro.config.js: imports of ./core resolve to the compiled
//    client (keep `scriptca build --watch` running alongside Metro)
import { withScriptcaMetro } from '@unikit-bridge/scriptca/react-native/metro';
export default withScriptcaMetro(getDefaultConfig(__dirname));
```

On device, TurboModule drop-in calls resolve as Promises — same semantics as the bridge client above.

`scriptca build --hosts react-native` also emits `NativeCable.ts` (TurboModule spec) and `cable.json` (RN CLI codegen config). **On Android the native side is generated AND shipped complete**: `scriptca build --platform android` cross-compiles the archive for android-arm64 (scriptc's `@scriptc/runtime-android-arm64`) and links it with the generated JNI dispatch into one ready `lib{name}_cable.so` — the Kotlin module (`CableModule.kt` + package) ships beside it. For Expo projects the `@unikit-bridge/scriptca/expo` config plugin wires everything during `expo prebuild` — no hand-written native module, no CMake:

```json
// app.json
{ "expo": { "plugins": ["@unikit-bridge/scriptca/expo"] } }
```

```bash
scriptca build --hosts react-native
scriptca build --platform android
bunx expo prebuild -p android
cd android && ./gradlew assembleDebug
```

Verified on-device: an Android 14 emulator runs the full chain — RN JS → TurboModule interop → the generated Kotlin module → JNI → C++ dispatch → the compiled core (`CABLE_RESULT:{"sum":42}` in logcat; `examples/react-native-app`, and `examples/react-native-app/device-jni-probe` for the no-RN variant). The generated dispatch also passes the JSON bridge contract on the host (`test:android`).

⚠️ Never add an `externalNativeBuild` block to the app gradle — RN 0.88's gradle plugin injects its own cmake that builds `libappmodules.so` (the core TurboModule bindings); a second block replaces the plugin's path and the app dies at launch with "'PlatformConstants' could not be found". The plugin-free path is `examples/react-native-app/scripts/wire-android.mjs` (copies the prebuilt `.so` as a jniLib — no CMake). For ARM-translation emulators build the app as arm64 (`-PreactNativeArchitectures=arm64-v8a`) so the whole process runs translated. iOS still links the archive in your Expo module (Xcode) — see `packages/react-native/README.md` for the full recipe and `examples/react-native-app` for the `useCable` hook pattern with automatic mock fallback.

**Expo**: the bundler is still Metro — wrap Expo's own default config and the drop-in applies unchanged (`examples/react-native-app/scripts/expo-bundle.mjs` is a verified smoke over Expo 58's real `getDefaultConfig`):

```js
// metro.config.js (Expo)
const { getDefaultConfig } = require('expo/metro-config');
const { withScriptcaMetro } = require('@unikit-bridge/scriptca/react-native/metro');
module.exports = withScriptcaMetro(getDefaultConfig(__dirname));
```

### Lynx

Use `@unikit-bridge/scriptca/webpack`'s `ScriptcaRspackPlugin` inside Rspeedy/Rsbuild, and `scriptca build --hosts lynx`.

## Watch mode

For hosts without their own watcher (Next.js on Turbopack via a predev script, plain Bun/Node apps):

```bash
scriptca build --watch
```

It watches the same inputs the build cache hashes — your core entry, its same-directory siblings, and the config files — and rebuilds (codegen and the `@unikit-bridge/scriptca-client` link included) when they change. Errors don't kill the watcher: fix the file and it rebuilds.

## Contract gate (CI)

```bash
scriptca build                 # writes .scriptca/contract.json
# …change API…
scriptca diff --fail-on-breaking   # exit 1 on removals / signature changes
```

## Performance

Benchmarks live in `examples/bench-core` (`bun run bench`): native (typed N-API addon / FFI) vs wasm (WASI) call latency/throughput plus cold/warm build times. Headline numbers on an M1 Max: **~24.5 ns/call** via the generated typed N-API addon on Node (~47 ns on Bun, still ahead of bun:ffi), 48 ns browser WASM, cold core build **~1.1 s**, warm (cached) **~166 ms** — **6.4× faster**. The `@unikit-bridge/scriptca-client` package adds no call-path cost (flavor selection is import-time resolution). See [BENCHMARK.md](./BENCHMARK.md).

**Boundary costs, honestly** (linux-x64, 2026-10-25): number calls land at **5–20 ns** (Bun fns / typed addon) and string round-trips at **~0.66–1.0 µs** after the marshaling round — Bun now routes string/bytes exports through the addon's C while numbers stay on bun:ffi. A string round-trip still pays one copy + UTF-8 encode/decode, so an API made of *many small string calls* is ~2× slower than plain TypeScript — keep such logic in TS or batch it inside one coarse export. `client.batch([['export', …args], …])` runs N calls across **one** boundary — the generated addon carries a batch executive and host builds (bun:ffi/koffi, no addon needed) link their own; routing picks the winner per composition (string batches −31% via the host executive on bun:ffi; number-only batches stay on direct dispatch where that's faster). The core-side alloc/copy plus one encode/decode remains the per-op floor (BENCHMARK §9). Compiled cores win where one crossing does real work (math, parsing, memory isolation). A `bench-gate` (`examples/bench-core`) guards both contracts against the committed per-platform baseline, and CI measures the Node(V8) tiers (`bench-node.ts`).

Repeat builds are cached automatically — `scriptca build --force` bypasses the cache.

## Monorepo scripts

```bash
bun install
bun run build
bun run test
bun run --filter @scriptca/example-bun-app start
bun run --filter @scriptca/example-node-app start
```

Note: `scriptc` must be a trusted dependency so Bun runs its install script (already configured in the root `package.json`).

## Publishing (maintainers)

Releases are tag-driven: push a version tag and CI publishes the single package **`@unikit-bridge/scriptca`**.

```bash
# 1. set version in packages/scriptca/package.json
# 2. commit, then tag and push
git tag v0.1.0 && git push origin v0.1.0
```

The `Release` workflow (`.github/workflows/release.yml`) runs the full test suite first (a `test` job with the same toolchain as CI — clang, zig, `bun run test`) and only then:

1. checks the tag matches `packages/scriptca` (`scripts/check-release-version.ts`),
2. builds and runs the **publish-form gate** (`scripts/pack-smoke.ts`): packs the assembled package, asserts no `workspace:` / `@scriptca` residue and every `files` / exports artifact is in the tarball, clean-room-installs it, and imports every public subpath plus the CLI bin `--help`,
3. publishes once (`bun publish --access public` from `packages/scriptca`).

Requires the `NPM_TOKEN` secret (an npm Automation token with `@unikit-bridge` publish rights). Re-publishing an existing version is rejected by npm — bump and re-tag. Provenance is pending `bun publish` support.

## Limitations (from scriptc)

- Core TypeScript must stay within [scriptc's supported subset](https://scriptc.dev/docs/limitations) (library mode is static-only).
- Hosts call **into** your library exports (C ABI); outbound FFI is for scriptc executables, not libraries.
- String/bytes use `(ptr, len)` in / `(out_ptr, out_len)` out on the native boundary.
- **clang (or gcc's `cc`)** is required for the default native shared-library link.
- WASM (`--target wasm`) needs zig **0.13.x** — CI's pinned, verified path (scriptc 0.4.12, 2026-11-13; local zig 0.16.0 also builds and runs) — plus a WASI polyfill in browsers.
- The **browser drop-in** initializes WASM with top-level await — build for **ES2022+** (Chrome 89+, Safari 15+, Firefox 89+). On stricter targets use `dropin: false` and the async `createClient()`.
- **Drop-in interception** applies only when the entry's entire runtime export surface is ABI-mappable (named functions); anything else disables it with a printed reason.
- **Drop-in host matrix** (verified 2026-10-22): Vite 6, Next 16 webpack graph (build + runtime), Metro 0.87 / RN 0.88, Expo 58 metro config, Electron 33 (main native + renderer WASM drop-in), Astro 5.18, SvelteKit 2, Nuxt 4.6, React Router 8.5, SolidStart 2.0 builds, rollup 4 (resolve redirect; TS transform is the host's) — end-to-end. **Deno 2.9 and Cloudflare Workers (workerd, wrangler 4.151) run the generated clients end-to-end** on the conditions path. Turbopack: entry drop-in unavailable (no resolve hook; see the host table). Rspeedy 0.18 stays on the conditions path. Lynx/TurboModule **on-device** call semantics remain unverified — no device in the loop.
- The codegen **CLI runs on Bun**; Deno/workerd hosts run the *generated client* (conditions path) after a build made on Bun — no Bun is needed at their runtime.
- Bundler plugins compile inside the host's build process, so any Node version is accepted there (`doctorRuntimeGate: 'skip'`); the Node ≥ 24 floor applies to running the CLI / generated clients directly.

## License

MIT
