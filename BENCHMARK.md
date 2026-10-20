# scriptcable Performance Report

**Date:** 2026-10-20 (re-measured after the `@scriptcable/client` package release) · **Host:** Apple M1 Max (10-core CPU, 64 GB) · macOS arm64
**Runtime:** Bun 1.4.3 · **Toolchain:** scriptc 0.3.6, Apple clang, zig 0.13 (WASM)

Run it yourself:

```bash
bun run --filter @scriptcable/example-bench-core build
bun run --filter @scriptcable/example-bench-core bench
```

## 1. Call latency & throughput — native (bun:ffi) vs wasm (WASI)

Median of 3 runs (2,000,000 iterations for cheap calls; 200,000 for compute/string). Cores: `examples/bench-core`.

| benchmark | native mean | wasm mean | native ops/s | wasm ops/s | native ÷ wasm |
| --- | --- | --- | --- | --- | --- |
| ping (call overhead) | 73 ns | 73 ns | ~13.6M | ~13.6M | **1.00×** |
| add (f64×2 → f64) | 80 ns | 80 ns | ~12.5M | ~12.5M | **1.00×** |
| fib(30) (CPU loop) | 97 ns | 91 ns | ~10.3M | ~11.0M | **0.94×** |
| repeat("ab",100) (string marshal) | 1.20 µs | 1.30 µs | ~0.83M | ~0.77M | **1.08×** |

**Reading:**

- The FFI/WASM boundary costs **~73–80 ns per call** on both engines — effectively identical. Choose native or WASM by deployment target, not speed.
- `fib(30)` shows compiled-core throughput (~10M calls/s each doing 30 iterations of work) — the boundary cost dominates; the compiled code itself runs at JS-comparable speed (JS baseline: `fib(30)` in 18 ns in-process, but that comparison ignores isolation/type-safety benefits).
- String round-trips cost ~1.2–1.3 µs because both directions copy through `(ptr, len)` marshalling. For chatty string APIs, batch work inside a single export.

## 2. Cross-runtime comparison — one core, four hosts

Same export (`add`, f64×2 → f64), same generated client surface, per-runtime measurement on this machine (2M iterations, warmed):

| runtime | JS engine | call path | mean/call | ops/s | notes |
| --- | --- | --- | --- | --- | --- |
| Bun 1.4.3 | JSC | bun:ffi → dylib | 73–80 ns | ~12.5M | default engine, zero extra deps |
| Node 22.21 | V8 | koffi 3.3 → dylib | 70–76 ns | ~13–14M | `npm i koffi` fallback |
| Web — Chromium 156 | V8 | WASM + minimal WASI | **48 ns** | ~20.9M | fastest path measured; `vite dev`, in-page loop |
| React Native (bridge pattern) | JSC* | async + JSON marshal hop | 165–181 ns | ~5.9M | *measured under Bun/JSC; **native transport excluded** — the device IPC hop dominates on hardware and was not measured (no device/simulator) |

**Reading:**

- All three direct-call hosts (Bun, Node, browser) land in the same ~50–80 ns band — runtime choice is about deployment, not speed. The browser WASM path is, if anything, the fastest.
- The RN client's extra cost is architectural (async bridge + JSON per hop), not the core: still sub-µs of JS per hop. Coarse-grained exports matter most on RN — one hop amortizes the marshal.
- Not measured: Hermes as the JS engine (RN's production engine), Metro bundle startup, physical-device bridge transport.

### vs other native-binding technologies

Same `add(f64, f64) → f64` export, this machine. Measured rows are our runs; cited rows are upstream claims we could not run here.

| technology | measured | mean/call | notes |
| --- | --- | --- | --- |
| napi-rs 2 addon (Rust, statically typed export) | ✅ | **22 ns** | built for this comparison (LTO, Node 22) — direct N-API boundary, no per-call type conversion |
| scriptcable browser client (Chromium, raw WASM) | ✅ | **48 ns** | thin generated glue over plain wasm — competitive with statically bound addons |
| koffi 3.3 (generic FFI, Node) | ✅ | 70–76 ns | generic symbol binding + per-call dynamic conversion |
| bun:ffi (generic FFI, Bun) | ✅ | 73–80 ns | same class as koffi |
| **scriptcable native client (Node / Bun)** | ✅ | **= host FFI** (70–80 ns) | the generated client binds the same symbols through the host's own loader — zero added layer |
| JSI hybrid object (Nitro-class, RN) | — cited | tens of ns (claimed) | statically compiled JSI bindings, no serialization — upstream (margelo/nitro) claims JSI-class overhead and "up to 55×" vs the legacy bridge; not runnable here (no RN host) |
| legacy RN bridge / TurboModule hop | ✅ JS-side | 165–181 ns + device transport | async + JSON per hop; transport not measured |
| Tauri `invoke` (webview IPC) | — cited | IPC-class (µs+) | requires a running Tauri shell; out of scope here |

**Reading:**

- **scriptcable adds no layer of its own** — its native call cost is exactly the host's FFI cost, because the generated client binds the core's symbols through the host's loader (koffi/bun:ffi) or plain WASM.
- A hand-written napi-rs addon beats generic FFI ~3× (22 vs 73 ns) thanks to statically typed bindings. That is the trade scriptcable makes deliberately: one TypeScript core compiled once → the same ABI surface on Bun, Node, browser, and RN, versus a per-host, per-language addon codebase. If you target Node only and need every nanosecond, write a napi addon; if you need four hosts from one source, scriptcable's ~50 ns/call premium over the fastest addon is usually irrelevant at the boundary's scale.
- The statically-typed-binding idea (napi-class ~22 ns) is a known future direction for generated clients (e.g. a compiled binding path instead of generic FFI).

Reproducibility of the napi-rs row — the whole addon:

```rust
use napi_derive::napi;

#[napi]
pub fn add(a: f64, b: f64) -> f64 {
  a + b
}
```

`cargo build --release` (LTO, `crate-type = ["cdylib"]`, macOS `-Wl,-undefined,dynamic_lookup`) → `.node`, then 2M in-process calls from Node 22.

## 3. JS host baseline (for context)

| benchmark | mean | ops/s |
| --- | --- | --- |
| js:ping | 1.3 ns | 754M |
| js:add | 1.2 ns | 816M |
| js:fib(30) | 18.2 ns | 55M |
| js:repeat(100) | 383 ns | 2.6M |

A pure in-process JS call is ~55–60× cheaper than crossing into a compiled core — the boundary, not the compiled code, is the cost. Design coarse-grained exports.

## 4. Build times (DX)

| metric | time | notes |
| --- | --- | --- |
| Cold core build (scriptc compile + clang link, both targets) | **~1.06 s** | full pipeline from an empty `.scriptcable` |
| Warm build (cache hit) | **~166 ms** | **6.4× faster** — skips scriptc + link via `.scriptcable/build-cache.json` |
| Warm repeat (cache + identical-codegen skip) | ~165 ms | content-hash codegen skip keeps editor watchers quiet |
| Full monorepo package build (12 pkgs, clean) | ~3.7 s | `bun run build`, parallel across 10 cores |

The build cache hashes entry sources + sibling module graph + ABI surface + target; any edit invalidates precisely and rebuilds (~1 s).

## 5. Engine startup (e2e)

| scenario | wall time |
| --- | --- |
| `@scriptcable/client` import → loaded client (bun flavor, dylib) → first calls ready | **~6.2 ms** |
| first two exported calls after load | ~0.16 ms |
| `bun src/main.ts` — full process: runtime boot, dylib load, 3 calls, exit | ~0.10–0.13 s |

The ~6 ms figure is measured inside the process (`performance.now()` around `import('@scriptcable/client')` + `createClient()`); the process wall adds Bun's own boot.

## 6. `@scriptcable/client` package — zero call-path cost

The package published into `.scriptcable/generated/` and linked as `node_modules/@scriptcable/client` is the generated client itself, exposed through export conditions — no wrapper layer, no indirection at call time:

- Resolution happens once at import; the bound methods are the same generated functions measured in §1 (73–80 ns/call).
- Runtime flavor selection (bun/node/browser/react-native) is static per environment — no branching in the call path.
- Verified end-to-end in a real browser: headless Chromium + `vite dev`, `createClient()` → WASM → `add(20, 22) = 42` (see the plan doc in `docs/plans/`).

## 7. Correctness gates (all green on this machine)

- 12/12 packages build, 12/12 typecheck
- Package tests: 40 pass, 0 fail (core 32 incl. client-package + link lifecycle, cli integration with real scriptc compile + subprocess call, vite plugin + HMR gating, next plugin-only integration, node/tauri adapters)
- e2e: bun-app, node-app (native + test), vite (SSR + WASM + browser build + headless-Chromium run), next (server + webpack wiring), tauri/lynx/react-native bridges
- Contract checks: `calculator` and `bench` cores — no changes

## Takeaways

1. **Native and WASM are interchangeable on speed** for scriptcable cores (~73–80 ns/call); pick per-platform.
2. **The build cache is the big DX win** — 6.4× faster inner loop on unchanged inputs, with precise invalidation.
3. **Coarse exports beat chatty ones** — batch string/bytes work to amortize the ~1.3 µs marshalling.
4. **`@scriptcable/client` adds no runtime cost** — flavor selection is import-time resolution; calls run at the measured engine speed everywhere (Bun CLI, Next server, browser).
5. Startup is snappy: ~6 ms from import to a loaded, callable native engine.
6. **Against the alternatives**: scriptcable's native calls cost exactly the host's FFI (no own layer). A dedicated napi-rs addon is ~3× faster at the boundary (22 ns) but is Node-only and per-language; scriptcable compiles one TS core for Bun + Node + browser + RN at 48–80 ns/call — and the browser WASM path (48 ns) is already in napi-rs territory.
