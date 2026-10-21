# Troubleshooting

Every entry here is a real error hit during development of scriptcable itself, with the fix that resolved it.

---

## Install / scaffold

### `error: @scriptcable/node@^0.1.0 failed to resolve`

The `@scriptcable/*` packages are **not published to npm yet**. Scaffold from a checkout instead:

```bash
bun <checkout-path>/packages/cli/dist/index.js init demo --host bun --from <checkout-path>
```

`--from` pins all `@scriptcable/*` deps to the checkout via `file:` + overrides (see [getting-started.md](./getting-started.md)).

### `Blocked 1 postinstall. Run 'bun pm untrusted' for details.`

`scriptc` ships an install script that fetches its binary. The scaffold already adds it to `trustedDependencies`; for manual setups add to your `package.json`:

```json
{ "trustedDependencies": ["scriptc"] }
```

then `bun install` again.

---

## Build

### `clang (or cc) is required to link the native shared library.`

Native builds link with clang:

```bash
# macOS
xcode-select --install
# Debian/Ubuntu
sudo apt install clang
```

### `error SC4003: … does not fit the declared marshalling class 'i64'` (on `bigint` params)

scriptc 0.3.x marshals only **f64 / u8 / u32 / i32** at the TypeScript level — `bigint` (i64) and wider classes are rejected. Use `number` for now; the generated N-API addon already speaks i64/u64 for when scriptc exposes them. Verify with `scriptcable coverage src/core.ts`.

### `error SC0001: Cannot find name 'u32'` (on `type X = u32` alias types)

Alias types like `type Hex = u32` are understood by scriptcable's **inference** but not by **scriptc's compiler** (0.3.x). Use plain `number` (→ f64) in the core.

### `error SC4001: symbol '…' is declared twice`

Two source functions resolved to the same export symbol — usually a duplicated function or two exports whose names collide after prefixing. Check the `inferred:` / `skipped:` lines `scriptcable build` prints; skipped (unmappable) functions can still collide with scriptc's own scan, so remove or rename them.

### `  addon: skipped — …` during build

The typed N-API addon failed to compile (missing clang, headers, or platform) — **this is not fatal**. Builds continue with the generic-FFI shared library, and the reason is recorded in `.scriptcable/addon-failed`. After fixing the cause, run `scriptcable build --force` once; a successful build clears the marker.

---

## Run

### `Cannot find module '@scriptcable/client'`

The client package is created by a build. Run it (or `scriptcable doctor`, which repairs the link):

```bash
scriptcable build     # or: bun run build
```

### `koffi is an optional fallback for running scriptcable native libraries under plain Node.js.`

You're on plain Node without the FFI fallback. Either run under Bun (default engine), or:

```bash
npm install koffi
```

Note: with the typed N-API addon built, plain Node works **without** koffi — the addon is the preferred path.

### `greet`/method returns `1` instead of `true`, or a negative number instead of a large unsigned one

You're on a pre-0.1 generated client — regenerate (`scriptcable build --force`). Current clients return real `boolean` and unwrapped `uint32`.

---

## Browser / web

### WASM fetch 404 or `TypeError: Failed to execute 'compileStreaming'`… compile error

The server must serve `.wasm` with `Content-Type: application/wasm`. The generated client falls back to `fetch` + `arrayBuffer` automatically — if you still see 404, the file isn't served. In Next.js client components, copy the wasm into your static dir and point at it:

```ts
const client = await createClient({ wasmUrl: '/demo.wasm' }); // after copying demo.wasm into public/
```

Server components / route handlers don't need any of this — the native flavor loads the shared library directly.

### Vite: `SyntaxError: Unexpected identifier` for a `.ts` file from the client

A static `public/` copy of `.scriptcable/generated/` shadows Vite's transformed modules. Serve only runtime artifacts (`.wasm`, `profile.json`) from `public/` — the Vite plugin copies the wasm itself; don't publish the generated directory.

---

## Drop-in

### `[scriptcable] drop-in disabled — …`

Interception is off for this project on purpose: the entry exports something a drop-in can't provide (a non-function value, a class, `default`, a re-export, or an `exports` list pinning a subset). The imports keep resolving to the TypeScript source; switch those call sites to `@scriptcable/client`, or make the entry export only ABI-mappable named functions.

### `next build` (Turbopack): imports still run the TypeScript core

Turbopack has no per-graph resolve hook, and `turbopack.resolveAlias` matches request specifiers — an absolute-path alias key does nothing (verified against Next 16). `withScriptcableAsync()` prints this once and leaves imports alone. Either run `next dev` / `next build --webpack` (drop-in per graph), or import `@scriptcable/client` — export conditions deliver the compiled client under Turbopack too.

### `Module not found: Can't resolve '../node.js'` (or `'../browser.js'`) in a webpack build

You're on an old build of the plugins: the generated clients import each other via `.js` specifiers (Node convention), and webpack needs `resolve.extensionAlias: { '.js': ['.js', '.ts', '.tsx'] }`. The `@scriptcable/next` hook and `@scriptcable/webpack` plugin set it for you since 2026-10-21 — update and rebuild.

### Metro bundles the TypeScript core even though `withScriptcableMetro` is registered

Check two things. (1) The drop-in must exist: run `scriptcable build --hosts react-native` (or keep `build --watch`) — before that, the resolver declines and imports stay source. (2) On metro ≥ 0.80, make sure you're on a current `@scriptcable/react-native`: older versions ran the existing resolver first — Metro's default config ships one, and it resolved the entry before the redirect could apply.

### Rspeedy / Rspack: `[scriptcable] rspack has no JS resolver hooks — entry drop-in unavailable here`

Not a bug: Rspack's Rust resolver has no `resolve.plugins` in its config schema (a pushed enhanced-resolve plugin is silently ignored — verified against Rspack 2.2.9). The plugin still builds the core, emits artifacts, and links `@scriptcable/client`; import the client by name and export conditions pick the compiled flavor.

---

## Diagnose everything at once

```bash
scriptcable doctor
```

reports runtime, scriptc, clang/zig, and the `@scriptcable/client` link state (and repairs the link when possible).
