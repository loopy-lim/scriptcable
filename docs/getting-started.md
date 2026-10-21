# Getting started

Every command below was executed end-to-end on 2026-10-21 (macOS, Bun 1.4.3, clang via Xcode CLT) and the outputs shown are what you should see. If a step prints something else, check [troubleshooting.md](./troubleshooting.md).

**Requirements:** [Bun](https://bun.sh) ≥ 1.2 · clang (macOS: `xcode-select --install`, Linux: `sudo apt install clang`)

---

## Path A — from a checkout of this repo (works today)

The `@scriptcable/*` packages are not on npm yet, so point the scaffold at your checkout with `--from`.

### 1. Build the toolchain once

```bash
git clone https://github.com/loopy-lim/scriptcable
cd scriptcable
bun install
bun run build
```

Expected: the last lines are `Exited with code 0` for each package (12 packages).

### 2. Scaffold an app

From **any** directory outside the repo (`--from` accepts an absolute or relative path):

```bash
bun <checkout-path>/packages/cli/dist/index.js init demo --host bun --from <checkout-path>
cd demo
```

Expected output:

```
Created …/demo (host=bun)
  cd demo && bun install && bun run doctor && bun run build && bun start
```

The scaffold pins `@scriptcable/*` to your checkout via `file:` dependencies (plus bun `overrides`), so nothing from npm is needed. `src/core.ts` is your core; `src/main.ts` is the app:

```ts
// src/main.ts — created by init
import { createClient } from '@scriptcable/client';

const client = await createClient();
console.log(JSON.stringify({
  sum: client.add(20, 22),
  hi: client.greet('bun'),
}));
client.dispose();
```

### 3. Install, doctor, build

```bash
bun install
bun run doctor
bun run build
```

Expected from `doctor` (trimmed):

```
  bun:      1.4.3 ✓
  scriptc:  0.4.0 …
  clang:    /usr/bin/clang ✓
OK — ready to build native cores.
```

(once a build has run, `doctor` also reports `client: @scriptcable/client → node_modules ✓`)

Expected from `build` (trimmed):

```
Building demo (native)…
  inferred:  3 exports from src/core.ts (no scriptcable.json exports declared)
  shared:    …/.scriptcable/libdemo.dylib
  addon:     …/.scriptcable/demo.node (typed N-API direct binding)
  generated: …/.scriptcable/generated
  client:    import { createClient } from '@scriptcable/client'
  contract:  …
```

Two things just happened: the core compiled to a native library **plus a typed N-API addon** (`demo.node` — the ~24 ns call path), and the generated clients were published as `node_modules/@scriptcable/client`.

### 4. Run

```bash
bun start
```

Expected:

```
{"sum":42,"hi":"hello, bun"}
```

### 5. Edit → rebuild → run

Edit `src/core.ts` (for example add):

```ts
/** Multiplies. */
export function mul(a: number, b: number): number {
  return a * b;
}
```

Then the same three commands — exports are re-inferred from types, nothing to declare:

```bash
bun run build && bun start     # {"sum":42,"hi":"hello, bun","mul":440}
```

> `bun start` runs the build for you on changed sources; repeated builds with unchanged inputs are cache hits (~166 ms vs ~1 s cold).

---

## Path B — from npm (after publish)

Once `@scriptcable/*` is on npm, steps 1–2 collapse to:

```bash
bunx @scriptcable/cli init demo --host bun
cd demo && bun install && bun run doctor && bun run build && bun start
```

Same expected outputs as Path A.

---

## Other hosts

| Host | Command | First call |
| --- | --- | --- |
| Node | `init demo --host node` (+ `npm i koffi` for plain Node; the typed addon works without it) | `bun start` / `node src/main.ts` |
| Vite / web | `init demo --host vite` → `bun run dev` | browser: `createClient()` → WASM, no args needed |
| Next.js | `init demo --host next` → server actions import the same client | see [README › Next.js](../README.md#nextjs--turbopack) |
| React Native / Tauri / Lynx | `--host react-native` / `tauri` / `lynx` | prints a host README with the native linking recipe |

All hosts import the same way:

```ts
import { createClient } from '@scriptcable/client';
const client = await createClient();
```

---

## Zero changes: drop-in imports (bundler hosts)

On bundler hosts you don't even write the `@scriptcable/client` import. Register the plugin and keep importing the core file — imports that resolve to the core entry are redirected onto a generated drop-in client with the same export names:

```ts
// vite.config.ts / webpack.config / next.config — just register the plugin
import { add, greet } from './src/core'; // → the compiled client, same names
add(20, 22); // 42
```

```ts
import scriptcable from '@scriptcable/vite'; // or:
import { ScriptcableWebpackPlugin } from '@scriptcable/webpack'; // or:
import { withScriptcable } from '@scriptcable/next'; // next build --webpack
```

Verified end-to-end (2026-10-21): Vite 6 dev+build, Next 16 webpack graph (build + runtime), Metro 0.87 / RN 0.88, Rspeedy 0.18. Turbopack and Rspack have no JS resolver hooks — there the `@scriptcable/client` import from Path A is the way (export conditions still deliver the compiled client). See the README host table for the full matrix.

---

## Where to go next

- [README](../README.md) — architecture, per-host adapters, contract gate (CI)
- [troubleshooting.md](./troubleshooting.md) — real errors and their fixes
- [BENCHMARK.md](../BENCHMARK.md) — per-runtime performance and where the numbers come from
- `scriptcable doctor` — diagnoses toolchain **and** the `@scriptcable/client` link (repairs it)
