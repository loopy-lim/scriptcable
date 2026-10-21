# Changelog

## Unreleased

### Added
- **scriptc 0.4.0 + i64/u64 end-to-end**: the toolchain now pins `scriptc@^0.4.0` (compiles clean under it — same contract hash, zig 0.13 WASM path unchanged) and scriptc 0.4's wider-integer classes work through the whole pipeline. Declare `"params": ["i64"]` / `"returns": "i64"` in `scriptcable.json` with the TS type `number` (scriptc 0.4's prove-or-refuse keeps values within ±(2^53 − 1), so `bigint` stays out). The typed N-API addon coerces numbers (and still accepts BigInt, losslessly) for i64/u64 params and returns doubles per the number contract; the generic-FFI path converts bun:ffi's BigInt returns to numbers; generated client types say `number`. Verified end-to-end: `square64(94906265) === 94906265²` exactly through the addon call path. scriptc 0.4 also compiles lib profiles with a `callbacks` section (native registration side lands — client-side callback plumbing is still future work).

- **Drop-in imports — register the plugin, get the speed**: the bundler plugins now redirect module imports that resolve to the core entry onto a generated **drop-in client** with the same export names, parameter names, and JSDoc as the source, so existing code keeps importing `./core` while the bundle runs the compiled library. Flavors: `dropin/browser.ts` (WASM, top-level-await init — build for ES2022+), `dropin/node.ts` (`createClientSync()` — **await-free**, safe in CommonJS-output server bundles; prefers the typed N-API addon, throws with the fix when no native artifact exists), `dropin/react-native.ts` (Metro — lazy bridge client, TurboModule calls resolve as Promises on device). Wiring: Vite automatic (`resolveId` with hook `order: 'pre'`, ahead of the builtin resolver), Webpack automatic (shared `enhanced-resolve` plugin in `resolve.plugins`), Next.js webpack automatic per graph (client → browser, server/edge → node), React Native via `withScriptcableMetro()` (`@scriptcable/react-native/metro`). Electron needs no new package: main process uses `@scriptcable/client` (node conditions), renderer the usual Vite/Webpack plugin. Accuracy first: any unmappable runtime export (non-function value, class, `default`, re-export, unmappable function, or an `exports` list pinning a subset) disables interception for that project with a one-line reason; `dropin: false` opts out. **Verified end-to-end against real hosts (2026-10-21): Vite 6 (dev+build), Next 16.4.2 webpack graph (`next build --webpack` + `next start` runtime call through the node drop-in), Metro 0.87 / RN 0.88 (real bundle), Rspeedy 0.18.2 (conditions path).** Turbopack has no per-graph resolve hook and its `resolveAlias` matches request specifiers — an absolute-path key is inert (verified: the TS entry stayed in the graph), so `withScriptcableAsync()` states that instead of setting a dead alias; Rspack's Rust resolver has no JS resolve-plugin hooks at all (`resolve.plugins` isn't in its config schema — verified), where the plugin keeps the build/link and imports resolve through `@scriptcable/client` export conditions.
- **Drop-in hardening from the real-host verification**: the Next webpack hook and the Webpack plugin merge `resolve.extensionAlias` so the generated clients' `.js`-specifier relative imports resolve to their `.ts` siblings (real Next builds failed with `Can't resolve '../node.js'`); Metro redirect now wins over an existing `resolver.resolveRequest` (Metro's default config ships one — an "existing resolver first" chain silently disabled the drop-in) and reads the importing file from `originModulePath` (metro 0.87's field name; older `originPath` still honored); the Metro resolver maps `.js` → `.ts` siblings inside the generated tree; `@scriptcable/{core,types,react-native}` declare `@babel/runtime` (their dist uses babel helpers — Metro resolves strictly); the webpack-family `node:wasi`/`node:fs/promises` dynamic imports are marked `webpackIgnore`/`turbopackIgnore` so browser graphs don't hit `UnhandledSchemeError`; and the plugins accept any host Node version (`doctorRuntimeGate: 'skip'`) — the Node ≥ 24 floor is a client-runtime policy, not a build constraint (found via real builds hard-failing under Node 22).
- `createClientSync()` / `loadNativeLibrarySync` in `@scriptcable/core` — the synchronous native path (bun:ffi / koffi load are synchronous; the former API only wrapped them in async), used by the drop-in server flavor.
- `canInterceptEntry` / `analyzeEntryExports` in `@scriptcable/core` — the entry export-surface analysis that gates interception (type-only exports ignored).
- `ScriptcableDropinResolvePlugin` / `createDropinResolvePlugin` in `@scriptcable/core` — the shared webpack-family resolver redirect, unit-tested against a stub resolver.
- **Browser WASM auto-apply**: the Vite / Next.js / Webpack plugins now ensure the `<name>.wasm` artifact (built automatically on first use, cached afterwards) and copy it into the static directory (`public/`), and the generated browser client resolves its URL by probing the module-relative location first (vite dev), then the origin root (Next `public/`, vite `public/` → dist root) — `createClient()` works in Next.js client graphs and in `vite build` output with no manual copy step. An explicit `wasmUrl` always wins; when no candidate answers HEAD, the original module-relative URL is used so its error surfaces exactly as before. The vite example's hand-rolled `sync-public.mjs` is gone.
- **`scriptcable build --watch`**: rebuilds on change for hosts without their own watcher (Next on Turbopack via a predev script, plain Bun/Node apps). Polls the same inputs the build cache hashes — the core entry, its same-directory siblings, and the config files — so what triggers a rebuild is exactly what can change the artifacts. Errors don't kill the watcher; a fixed file triggers the rebuild.
- **CI-durable client dep by default**: `scriptcable init` now records `"@scriptcable/client": "file:.scriptcable/generated"` in the scaffold's dependencies together with a placeholder manifest (`.scriptcable/generated/package.json` + `placeholder.ts`) and the gitignore negations that keep `bun install` working before the first build (bun fails a `file:` dep whose target has no package.json). The first `scriptcable build` overwrites the placeholder with the real flavors. `scriptcable doctor` reports projects missing the dep and prints the exact snippet (report-only — auto-writing it without the committed placeholder would break fresh-clone installs).
- **Streaming WASM compile in the browser client**: the generated browser glue now uses `WebAssembly.compileStreaming(fetch(url))` — compile overlaps download — with an automatic fetch+arrayBuffer fallback when the server omits the `application/wasm` content type. Cold `createClient()` median in headless Chromium: ~2.25 ms → ~1.9 ms on the 64 KB bench core; the overlap grows with core size. `loadWasmModule` accepts a pre-compiled `module` to support this.
- **Typed N-API direct binding**: `scriptcable build` now compiles a per-export typed C addon (`{name}.node`) against the core archive, and the generated Node/Bun clients prefer it automatically — **~24.5 ns/call on Node** (napi-rs-class from generated code, ~3× faster than generic FFI) and ~47 ns on Bun (still ahead of bun:ffi). The generic-FFI fallback (70–80 ns) remains automatic when the addon is absent or unloadable. Strings/bytes ride the same `(ptr, len)` ABI through the addon; cores with callbacks skip the addon (printed reason). Uses `node-api-headers` (header-only).
- **One client import for every host**: builds now publish the generated clients as a real package — `scriptcable build` (and the Vite / Next.js / Webpack plugins, via the shared `writeGeneratedClients` emit) writes a package manifest into `.scriptcable/generated/` and links it as `node_modules/@scriptcable/client`. App code imports `createClient` from `@scriptcable/client` with no knowledge of `.scriptcable/` paths. Export conditions resolve the flavor per environment (`bun` → bun:ffi, `node` → native shared lib, `browser` → WASM with an optional WASI adapter, `react-native` → bridge), and explicit subpaths (`/node`, `/bun`, `/browser`, `/react-native`, `/lynx`, `/tauri`) pin one. Editors resolve the same package, so TypeScript works without `paths` config.
- `writeGeneratedClients` / `writeClientPackage` / `ensureClientPackageLink` / `clientPackageManifest` in `@scriptcable/core` — the single emit point for client flavors, the `@scriptcable/client` package manifest, and the idempotent `node_modules` link (repairs dangling links, never touches a real package).
- `withScriptcable` now merges `transpilePackages: ['@scriptcable/client']` into the Next config (webpack and Turbopack paths).
- `scriptcable doctor` reports — and repairs — the `@scriptcable/client` link state.
- `scriptcable build` logs the client import line and the `init` scaffold for bun/node hosts uses `@scriptcable/client` instead of a hard-coded `outDir`.
- **Zero-config builds**: `scriptcable build` (and `diff`, bundler plugins, adapters) work with no `scriptcable.config.ts`/`scriptcable.json` — `name` is inferred from `package.json` (scoped names slugified, else the directory name) and `entry` from standard locations (`src/core.ts` > `core.ts` > `src/index.ts` > `index.ts`). Explicit config always wins; `name`/`entry` in a config file are now optional too.
- `resolveProjectConfig` / `loadConfigFile` in `@scriptcable/core` — single resolution point; `--config`-style explicit paths accept `.ts` configs as well as `.json`.
- Integration test building a real native core with no config file (`packages/cli`).

### Changed
- **Vite / Next.js / Webpack plugins read `scriptcable.config.ts`** (previously JSON-only, conflicting with `init`'s scaffolded TS config) and share the same zero-config resolution; when both config files exist, the TS config wins — same precedence as the CLI. The `configPath` plugin option is now opt-in instead of defaulting to `scriptcable.json`.
- `ScriptcableConfig.name`/`entry` are optional in `@scriptcable/types` (`ResolvedConfig` = resolved shape used by `configToProfile`/`buildCore`/`generateClients`).
- `createNodeEngine()` / `createBunEngineFromOutDir()` default `outDir` to `.scriptcable`.
- Generated browser clients accept `createClient()` with no arguments — the WASI adapter is optional and defaults to the built-in minimal polyfill.
- **Docs corrected against scriptc 0.3.6 behavior**: the README claimed `bigint`→`i64` and `type UserId = u32` inference; in reality scriptc rejects both (SC4003 — TS-level marshalling classes are f64/u8/u32/i32, so cores use `number`/`string`/`boolean`/`Uint8Array`; SC0001 on alias types). `infer` keeps skipping `bigint` with a printed reason — mapping it would turn a graceful skip into a build failure. The generated N-API addon already handles i64/u64 for when scriptc exposes them.
- Generated node/bun clients also search the project-relative `.scriptcable/generated/` for the shared library/WASM, so bundled server runtimes (e.g. Next.js) resolve artifacts even when the module URL is rewritten.
- The Vite plugin resolves `@scriptcable/client` (and `virtual:scriptcable`) to the real generated browser client instead of a virtual re-export — a virtual re-export of its absolute path served raw, untransformed TypeScript to the browser. The generated browser client now also re-exports the `ScriptcableClient` type, keeping the previous virtual module's surface. Found by headless-browser verification (`vite dev` + Chromium, `createClient()` → WASM → `add(20, 22) = 42`).

## 0.3.0 — 2026-10-20

### Added
- **Build cache** (`.scriptcable/build-cache.json`): repeat builds skip scriptc + link when sources/ABI/target are unchanged — ~465 ms → ~70 ms (6.6×). `scriptcable build --force` bypasses. Codegen now skips identical file writes (editor-friendly).
- **Benchmark suite** (`examples/bench-core` + `bench()`/`formatTable()`/`formatComparison()` in `@scriptcable/testing`): native vs wasm latency/throughput, JS baseline, cold/warm build timing. Results documented in `BENCHMARK.md` (M1 Max: ~75 ns/call both engines).
- Structured CLI errors with hints (`formatError`), doctor shows cache note and checkmarks.
- Unit tests for the build cache (hash stability, invalidation, artifact-presence gating).

## 0.2.0 — 2026-10-20

### Changed
- **Bun is now the engine for everything**: `packageManager: bun@1.4.3`, `bun install`/`bun run --filter`, `bun test` (`bun:test`), scripts run TS directly (no `--experimental-strip-types`)
- pnpm fully removed (`pnpm-workspace.yaml`, lockfile, all `pnpm --filter` scripts)
- `scriptc` moved to `trustedDependencies` so Bun runs its native install script
- `doctor` checks Bun ≥ 1.2 (Node ≥ 24 accepted as fallback runtime)
- `scriptcable init` defaults to `--host bun`; generated projects use `bun` scripts and `bunx`
- koffi is no longer a dependency of `@scriptcable/core` — it is an optional plain-Node fallback; Bun uses built-in `bun:ffi`

### Removed
- Rust crates `scriptcable-sys` / `scriptcable-tauri` and the Tauri Rust example app (this repo is pure TypeScript + scriptc; Tauri hosts link `lib{name}.a` in their own shell)
- React Native / Lynx C++ host smoke binaries, podspec, and Android JNI stubs

## 0.1.0 — 2026-10-19

### Added
- Monorepo: `@scriptcable/{types,core,cli,node,bun,tauri,react-native,lynx,vite,next,webpack,testing}`
- Native-default builds: scriptc `.lib.a` → `lib{name}.so` (Node/Bun) + self-contained `lib{name}.a` (native hosts)
- WASM opt-in with bundled minimal WASI polyfill (`@scriptcable/core/wasi`)
- React Native & Lynx typed bridges
- Vite / Next / Webpack(Rspack) plugins; `scriptcable init --host …`
- Contract gate: `scriptcable diff`
- Examples for Bun, Node, Vite, Next, Tauri, RN, Lynx

### Notes
- Full Tauri webview `tauri build`, RN device builds, and Lynx Explorer remain host-toolchain dependent
