# scriptcable Performance Report

**Date:** 2026-10-20 · **Host:** Apple M1 Max (10-core CPU, 64 GB) · macOS arm64
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
| ping (call overhead) | 74–78 ns | 74–107 ns | ~13.3M | ~12.1M | **~1.0x** |
| add (f64×2 → f64) | 80–82 ns | 80–84 ns | ~12.3M | ~12.2M | **~1.0x** |
| fib(30) (CPU loop) | 95–97 ns | 91–94 ns | ~10.3M | ~10.8M | **~0.96x** |
| repeat("ab",100) (string marshal) | 1.24–1.55 µs | 1.30–1.34 µs | ~0.75M | ~0.76M | **~1.0x** |

**Reading:**

- The FFI/WASM boundary costs **~75 ns per call** on both engines — effectively identical. Choose native or WASM by deployment target, not speed.
- `fib(30)` shows compiled-core throughput (~10M calls/s each doing 30 iterations of work) — the boundary cost dominates; the compiled code itself runs at JS-comparable speed (JS baseline: `fib(30)` in 19 ns in-process, but that comparison ignores isolation/type-safety benefits).
- String round-trips cost ~1.3 µs because both directions copy through `(ptr, len)` marshalling. For chatty string APIs, batch work inside a single export.

## 2. JS host baseline (for context)

| benchmark | mean | ops/s |
| --- | --- | --- |
| js:ping | 1.3 ns | 756M |
| js:add | 1.3 ns | 777M |
| js:fib(30) | 19 ns | 53M |
| js:repeat(100) | 374 ns | 2.7M |

A pure in-process JS call is ~50–60× cheaper than crossing into a compiled core — the boundary, not the compiled code, is the cost. Design coarse-grained exports.

## 3. Build times (DX)

| metric | time | notes |
| --- | --- | --- |
| Cold core build (scriptc compile + clang link) | **~465 ms** | `rm -rf .scriptcable && scriptcable build --target both` |
| Warm build (cache hit) | **~70 ms** | **6.6× faster** — skips scriptc + link via `.scriptcable/build-cache.json` |
| Warm repeat (cache + identical-codegen skip) | ~69 ms | content-hash codegen skip keeps editor watchers quiet |
| Full monorepo package build (12 pkgs, clean) | ~3.1 s | `bun run build`, parallel across 10 cores |

The build cache hashes entry sources + sibling module graph + ABI surface + target; any edit invalidates precisely and rebuilds (~0.5 s).

## 4. Engine startup (e2e)

| scenario | wall time |
| --- | --- |
| `bun src/main.ts` — load `.dylib` via bun:ffi, 3 calls, exit | ~20 ms |
| Same via wasm/WASI reactor | ~25 ms |

## 5. Correctness gates (all green on this machine)

- 12/12 packages build, 12/12 typecheck
- Package tests: 7 suites, 12 tests, 0 fail (incl. 4 build-cache unit tests)
- e2e: bun-app, node-app (native + test), vite (SSR + WASM + browser build), next (server + webpack wiring), tauri/lynx/react-native bridges
- Contract checks: `calculator` and `bench` cores — no changes

## Takeaways

1. **Native and WASM are interchangeable on speed** for scriptcable cores (~75 ns/call); pick per-platform.
2. **The build cache is the big DX win** — 6.6× faster inner loop on unchanged inputs, with precise invalidation.
3. **Coarse exports beat chatty ones** — batch string/bytes work to amortize the ~1.3 µs marshalling.
4. Bun's startup (~20 ms to loaded FFI engine) makes CLI/server usage snappy.
