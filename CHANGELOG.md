# Changelog

## Unreleased

### Added
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
