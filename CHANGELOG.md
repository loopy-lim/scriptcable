# Changelog

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
