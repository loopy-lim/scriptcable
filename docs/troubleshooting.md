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

Native builds link with clang — **gcc's `cc` works too**:

```bash
# macOS
xcode-select --install
# Debian/Ubuntu
sudo apt install clang    # or: gcc (cc) alone is enough
```

### `Cannot find module '@scriptcable/core'` (or any `@scriptcable/*`) right after install

The packages' exports point at `./dist/*.js` — nothing is compiled until the first build, and Bun reports a missing exports target as "Cannot find module". Run the build first, then the tests:

```bash
bun install && bun run build && bun run test
```

### After upgrading Bun (1.4+), every workspace import fails to resolve

Bun 1.4 defaulted its installer to the **isolated linker**, which this monorepo's workspace-package resolution can't read. The repo pins the classic layout in `bunfig.toml`:

```toml
[install]
linker = "hoisted"
```

If you copied the repo without that file (or flipped it), reinstall after restoring it: `rm -rf node_modules packages/*/node_modules examples/*/node_modules && bun install`.

### Electron main fails with `ERR_UNKNOWN_FILE_EXTENSION ".ts"` when importing `@scriptcable/client`

Electron's embedded Node (20.x) cannot import `.ts` at all. The generated package ships **compiled `.js`** for the `bun`/`node` conditions and the manifest points there — re-run `scriptcable build` (or the bundler plugin) on a checkout older than 2026-10-22 to regenerate `package.json` + `node.js`/`bun.js` in `.scriptcable/generated/`.

### `error SC4003: … has IR type 'bigint', which does not fit the declared marshalling class 'i64'`

scriptc ≥ 0.4 exposes **i64/u64 as TS `number`** (not `bigint`) — the compiler proves your value range and refuses anything that can't stay within ±(2^53 − 1) (error SC4023). So: declare the export in `scriptcable.json` with `"params": ["i64"]`, keep the TS type `number`, and keep values bounded (`if (n > 94906265) return 0;` makes `n * n` provable). `bigint` stays unsupported — `n * 2^n`-style unbounded math can't ride float64. Narrow classes (`u8/u32/i32`) are param-only; `f64` is the general number.

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

## Deno

### `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` for a file inside `@scriptcable/client`

Deno never strips types under `node_modules` — that's why the generated **`deno` flavor ships as compiled `.js`** (the same policy as the `bun`/`node` flavors). If you see this error you're resolving a `.ts` file of the generated package, which means the manifest predates deno support: re-run `scriptcable build --target wasm --hosts deno` (or newer) so the manifest points the `deno` condition at `deno.js`.

### Deno picks the Node (`.so`) flavor instead of the Deno one

Deno enables the `node` export condition itself. The generated manifest therefore lists `deno` **before** `node`, and first-match picks the Deno flavor. If your manifest was generated by an older build it has no `deno` condition at all — rebuild.

### Deno tries to fetch `@scriptcable/*` from the npm registry

The generated client imports `@scriptcable/core/wasm` + `/wasi` by bare specifier, resolved by walking up `node_modules`. Inside a workspace this resolves from the root install. In a standalone project, recording `@scriptcable/client` as a `file:` dependency (what `scriptcable init` does) is not enough on its own — the `deno.js` flavor itself imports `@scriptcable/core/wasm` and `/wasi`, so `@scriptcable/core` must also be resolvable from the project's `node_modules` tree (published packages after release, or a local link/workspace while developing here).

## Cloudflare Workers

### The worker bundle fetches `<name>.wasm` and fails at runtime (or the browser flavor got bundled)

Wrangler resolves bundles with **both** `workerd` and `browser` conditions on; the generated manifest lists `workerd` first, so the workers flavor — which statically imports the wasm via wrangler's default CompiledWasm rule — wins. If you see fetch-based probing in your bundle, the manifest is stale: rebuild with `--hosts workers`.

### SolidStart 2 build fails: `rollupOptions.input should not be an html file when building for SSR`

SolidStart 2's peer range is **vite `^8 || ^9`** (the rolldown mainline) — it configures environments through `rolldownOptions`, which rollup-based vite 7 ignores, so the ssr environment falls back to the default `index.html` input. Pin `vite: ^8` in the app (`examples/solidstart-app` does).

## Android

### `scriptc: unsupported native compiler target: x86_64-linux-android`

scriptc's Android support is **arm64-only** today (`@scriptc/runtime-android-arm64`). Use `--platform android` (always android-arm64) and run the app on an arm64 device/emulator — CI arm64 runners have KVM, so the emulator runs at native speed there.

### `error SC3003: runtime pack for android-arm64 is not installed`

scriptc ships runtime packs per target. `scriptcable build --platform android` auto-installs `@scriptc/runtime-android-arm64` into the project (same as the wasm pack) — if you hit this, you're invoking `scriptc` directly; add the pack as a devDependency or run through scriptcable.

### `ld.lld: error: relocation R_AARCH64_... cannot be used against symbol 'scr_...'` when linking the android .so

The archive objects use direct PC-relative references; in a shared library every default-visibility symbol is preemptible, so lld refuses them. The build emits a version script (`global: Java_*; local: *;`) that localizes everything but the JNI entry points — if you link the archive yourself, do the same. Also pass `-nostdlib`: zig has no bionic to resolve, and a dlopen'd module gets libc symbols from the Android runtime.

### Expo/RN app dies at launch: `'PlatformConstants' could not be found` → `Global was not installed`

An `externalNativeBuild` block in the app gradle replaces the cmake that RN 0.88's gradle plugin injects — that injected build produces `libappmodules.so`, which registers the core TurboModules (`PlatformConstants` among them). scriptcable's config plugin (`@scriptcable/expo`) does NOT add one: the bridge `.so` is prebuilt by `scriptcable build --platform android` and ships as a plain jniLib. If you wired things by hand, do the same — jniLibs only, never a second cmake. (Verified by isolation: the identical failure occurs with the scriptcable package removed, as long as the foreign cmake block is present.)

### arm64-only APK on an x86_64 ARM-translation emulator: `dlopen failed: ... is for EM_AARCH64` or `cannot locate symbol "stderr"`

Two different layers: (1) SoLoader picks the APK lib dir by the DEVICE's preferred ABI — with `extractNativeLibs=false` an arm64-only APK is never extracted there; fix with `expo.useLegacyPackaging=true` (the config plugin flips it). (2) Whether a foreign-ABI `.so` can be dlopen'd from an x86_64 process depends on the image's translation: Android 16 google_apis images reject it outright (`is for EM_AARCH64 instead of EM_X86_64`), Android 14 resolves functions but fails eager DATA relocations (`stderr`, `environ`). Build the app **arm64-only** (`-PreactNativeArchitectures=arm64-v8a`) so the whole process runs translated — that works on both.

### Emulator/app-level verification

`bun run --filter @scriptcable/example-react-native-app test:android` proves the generated dispatch (compiles the generated C++ verbatim on the host, asserts the JSON bridge contract). The full RN app runs on-device too: the config-plugin flow (`expo prebuild` → gradle → install) was verified end-to-end on a local Android 14 emulator — `CABLE_RESULT:{"sum":42}` in logcat (`examples/react-native-app`, `device-jni-probe` for the RN-free variant). CI: `.github/workflows/android-emulator.yml`.

## Nuxt

### `No core entry found: … none of src/core.ts … exist in <project>/app`

Nuxt 4 points vite's root at its `srcDir` (`app/`), so the plugin looked for the config there. Pass the project root explicitly — the one Nuxt-specific option: `scriptcable({ root: import.meta.dirname })` in `nuxt.config.ts`.

### First `nuxt build` doesn't ship `<name>.wasm` (second build does)

Nuxt snapshots `public/` into `.output/` before the client build runs, and the plugin copies the wasm into `public/` during that build. Since 2026-10-22 the plugin also emits the wasm as a **bundle asset** (same unhashed name), so the first build ships it — update `@scriptcable/vite` and rebuild.

---

## Diagnose everything at once

```bash
scriptcable doctor
```

reports runtime, scriptc, clang/zig, and the `@scriptcable/client` link state (and repairs the link when possible).
