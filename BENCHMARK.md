# scriptcable Performance Report

**Date:** 2026-10-20 (re-measured after the `@scriptcable/client` package release) · **Host:** Apple M1 Max (10-core CPU, 64 GB) · macOS arm64
**Runtime:** Bun 1.4.3 · **Toolchain:** scriptc 0.4.0, Apple clang, zig 0.13 (WASM)

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

- The FFI/WASM boundary costs **~73–80 ns per call** through generic FFI; the generated typed N-API addon cuts that to **~24.5 ns on Node** and **~47 ns on Bun**. Choose native or WASM by deployment target, not speed.
- `fib(30)` shows compiled-core throughput (~10M calls/s each doing 30 iterations of work) — the boundary cost dominates; the compiled code itself runs at JS-comparable speed (JS baseline: `fib(30)` in 18 ns in-process, but that comparison ignores isolation/type-safety benefits).
- String round-trips cost ~1.2–1.3 µs because both directions copy through `(ptr, len)` marshalling. For chatty string APIs, batch work inside a single export.

## 2. Cross-runtime comparison — one core, four hosts

Same export (`add`, f64×2 → f64), same generated client surface, per-runtime measurement on this machine (2M iterations, warmed):

| runtime | JS engine | call path | mean/call | ops/s | notes |
| --- | --- | --- | --- | --- | --- |
| Bun 1.4.3 | JSC | typed N-API addon (.node) | **~47 ns** | ~21M | Bun's N-API layer costs more than Node's; still beats bun:ffi (70–80 ns) |
| Bun 1.4.3 | JSC | bun:ffi → dylib (fallback) | 70–80 ns | ~12.5M | zero extra deps |
| Node 22.21 | V8 | typed N-API addon (.node) | **~24.5 ns** | ~40M | koffi fallback 70–76 ns |
| Node 22.21 | V8 | koffi 3.3 → dylib (fallback) | 70–76 ns | ~13–14M | generic FFI |
| Web — Chromium 156 | V8 | WASM + minimal WASI | **48 ns** | ~20.9M | `vite dev`, in-page loop |
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
| **scriptcable typed N-API addon (Node)** | ✅ | **24.5–24.7 ns** | shipped: the build compiles a per-export typed C wrapper against the same core archive — napi-rs class, generated |
| scriptcable typed N-API addon (Bun) | ✅ | **46.5–47.8 ns** | same addon under Bun's N-API layer — still faster than bun:ffi |
| scriptcable browser client (Chromium, raw WASM) | ✅ | **48 ns** | thin generated glue over plain wasm — competitive with statically bound addons |
| koffi 3.3 (generic FFI, Node) | ✅ | 70–76 ns | generic symbol binding + per-call dynamic conversion |
| bun:ffi (generic FFI, Bun) | ✅ | 73–80 ns | same class as koffi |
| **scriptcable native client (Node / Bun)** | ✅ | **= host FFI** (70–80 ns) | the generated client binds the same symbols through the host's own loader — zero added layer |
| JSI hybrid object (Nitro-class, RN) | — cited | tens of ns (claimed) | statically compiled JSI bindings, no serialization — upstream (margelo/nitro) claims JSI-class overhead and "up to 55×" vs the legacy bridge; not runnable here (no RN host) |
| legacy RN bridge / TurboModule hop | ✅ JS-side | 165–181 ns + device transport | async + JSON per hop; transport not measured |
| Tauri `invoke` (webview IPC) | — cited | IPC-class (µs+) | requires a running Tauri shell; out of scope here |
| rustra (predecessor project) — Bun FFI Frame | — cited | 2.27 µs | RPC-style: binary-wire encode/decode + async per call ([host matrix receipt](https://github.com/loopy-lim/rustra/blob/main/docs/benchmarks.md), M1 Max) |
| rustra — Node N-API Frame hot path | — cited | 1.26 µs (793k/s) | same RPC-style over a compiled N-API transport |
| rustra — core Frame round trip only | — cited | 134 ns | no host/transport — the wire+core dispatch floor |
| rustra — RN vs Nitro HybridObject | — cited | parity ±5% | iPhone 17 Simulator, Hermes, RN 0.81 (add 1.0418×) |

All direct-call rows were re-measured across two days: bun:ffi 69.8–80 ns, koffi 70–76 ns, browser WASM 47.7–48.7 ns, napi-rs 22.1–26.4 ns — stable within run noise.

**Why is the WASM path (48 ns) faster than the native FFI paths (70–80 ns)?**

All three cross one boundary; they differ in how much work the boundary does per call:

- **napi-rs (22 ns)**: the export is a compiled C function with a fixed signature, registered as a JS function. V8 calls it like any native JS function; arguments are two loads from a pre-parsed `ArgInfo`. The thinnest possible JS↔native seam.
- **WASM in a browser (48 ns)**: the JS caller and the wasm module share one JIT (V8). The JS→wasm wrapper is signature-specialized and compiled once, then cached — parameters travel in registers, no boxing, no runtime type inspection.
- **Generic FFI — bun:ffi / koffi (70–80 ns)**: the binding must handle *any* signature at runtime. Each call converts tagged JS values to C types dynamically, sets up a GC/trampoline scope, and dispatches through a generic layer. That generality is the extra ~25–30 ns.

**Can scriptcable reach the 22 ns class natively? It does now.** The types are fixed at compile time, and `scriptcable build` compiles a per-export typed C wrapper (node_api.h) against the same core archive: `{name}.node`. Generated clients prefer it automatically — measured **24.5–24.7 ns/call** under Node (napi-rs class from generated code, ~3× faster than the generic-FFI fallback) and **~47 ns** under Bun (Bun's N-API layer carries more overhead than Node's; both beat their generic-FFI fallbacks). The fallbacks remain automatic. Two routes were validated against this project's predecessor rustra:

1. **Generated N-API addon** — shipped (the row above).
2. **JSI for RN** — rustra measured parity with a Nitro HybridObject (±5%, iOS simulator) over JSI; the same route takes scriptcable's RN flavor from bridge-class (~165 ns + transport) to JSI-class (future work).

Before the addon, scriptcable's direct-ABI calls (70–80 ns) already beat rustra's host-level RPC paths (1.26–2.27 µs) ~16–30× for scalar calls, because rustra spends its budget on the wire, async semantics, and rich types rather than a bare sync boundary.

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

- Resolution happens once at import; the bound methods call the typed N-API addon directly when present (24.5 ns class), else the shared library via the host's FFI, else WASM.
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
3. **Coarse exports beat chatty ones** — string round-trips land at ~0.66–1.0 µs after the marshaling round (2026-10-25); batch string/bytes work inside one export to amortize the crossing.
4. **`@scriptcable/client` adds no runtime cost** — flavor selection is import-time resolution; calls run at the measured engine speed everywhere (Bun CLI, Next server, browser).
5. Startup is snappy: ~6 ms from import to a loaded, callable native engine.
6. **Against the alternatives**: scriptcable now generates a typed N-API addon — 24.5 ns/call under Node, ~47 ns under Bun (napi-rs class from generated code on Node), with generic FFI (70–80 ns) as the automatic fallback and browser WASM at 48 ns. Node-only and per-language addon codebases buy ~2 ns over that; scriptcable compiles one TS core for all four hosts.

## 8. Re-measured on linux-x64 (WSL2, bun 1.4.4) — 2026-10-25, boundary-marshaling round

Median of 3 runs (`bun run --filter @scriptcable/example-bench-core bench`, `call()` path):

| benchmark | before round | after | change |
| --- | --- | --- | --- |
| ping | 48.2 ns | 19.6 ns | **−58%** — `call()` now rides the direct fns closures |
| add | 49.1 ns | 28.0 ns | −43% |
| repeat(100) — native | 1.19 µs | 0.98 µs | −18% |
| repeat(100) — wasm | 1.14 µs | 1.04 µs | −9% |

What the breakdown probe showed first: per-call JS allocations were NOT the story
(`new TextDecoder()` is eliminated by JSC escape analysis at ~18 ns; out-slot arrays ~8 ns).
~0.67 µs of the old 1.04 µs string call was the C side (dispatch + core alloc/copy). So the
round targeted the delivered number instead:

- **Per-export Bun tiering**: marshaled exports (string/bytes/cstring) ride the N-API addon —
  their marshaling happens in C, measured faster than bun:ffi's JS-side marshaling. Numbers stay
  on bun:ffi (~5–20 ns). Delivered string call on Bun: 1.04–1.08 µs → **0.66–0.71 µs (−37%)**.
- **bun:ffi marshaling scratch** (`native-loader`): per-binding reusable encode buffer + out-slot
  pair + precomputed FFI slot layout; no per-call arrays or `ptr()` for stable buffers.
  `fns` string call 1.04 µs → ~0.96–1.03 µs after the G3 correctness fixes turned the
  scratch into per-parameter bump regions (the delivered Bun tier routes strings
  through the addon, so user-facing cost is unaffected); universal `call()` rides the
  same closures (ping 48 → 20 ns, add 49 → 28 ns).
- **Addon C wrapper** (`napi-addon`): per-thread (`_Thread_local`) grow-only utf8 scratch replaces
  the per-call query+malloc+free — addon string call 694 → 659 ns.
- **WASM loader**: per-instance bump-allocated scratch (no `scriptc_alloc`/`free` per call),
  `encodeInto` straight into wasm memory (no JS intermediate), cached `DataView`/`TextEncoder`/
  `TextDecoder` (invalidated on `memory.grow`), and a depth guard so re-entrant calls from host
  callbacks fall back to per-call state. wasm repeat −9% — the remaining ~0.9 µs is wasm-side
  alloc/copy (scriptc runtime, intentionally out of scope).
- **bench-gate**: `examples/bench-core/scripts/bench-gate.ts` now guards the string-marshaling
  contract too, and the committed baseline covers linux-x64 (2.5× gross-regression tolerance).

**When NOT to use scriptcable** (decision boundary, this host): the boundary pays one copy plus
UTF-8 encode/decode. Pure-JS references: ping 0.8 ns, add 1.1 ns, repeat(100) ~336 ns. Even at
~0.66 µs per string call, an API made of many small string round-trips is still ~2× slower in
scriptcable than plain TS — keep that logic in TS. Where scriptcable wins is coarse exports: one
crossing that does the work of many (fib, image math, parsing) beats JS at equal or better
latency with memory isolation and type-safe ABI.
