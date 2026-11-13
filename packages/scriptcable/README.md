# @unikit-bridge/scriptcable

One TypeScript core, compiled by [scriptc](https://github.com/vercel-labs/scriptc) into a native shared library and WASM, generating **type-safe clients for every host** — Bun, Node, Deno, Tauri, React Native, Lynx, Cloudflare Workers, Vite, Webpack/Rspack, and Next.js — from a single package.

## Install

```bash
bun add -d @unikit-bridge/scriptcable
bunx @unikit-bridge/scriptcable init --host bun   # or node / vite / …
```

Requires **Bun ≥ 1.2** (the CLI and the bun client use it). The Node client wants Node ≥ 24. `clang` links the native library; zig auto-provisions for WASM builds.

## Use

Host adapters import from subpaths of this one package:

```ts
import { createClient } from '@unikit-bridge/scriptcable/node'; // node
import { createClient } from '@unikit-bridge/scriptcable/bun';  // bun
import { createClient } from '@unikit-bridge/scriptcable-client'; // generated client (linked into your project by `scriptcable build`)
```

Bundler plugins: `@unikit-bridge/scriptcable/vite` · `/webpack` · `/next` · `/expo`. Other subpaths: `/types`, `/core` (+ `/core/wasm`, `/core/native`, `/core/toolchain`, `/core/contract`, …), `/testing`, `/react-native` (+ `/react-native/metro`), `/tauri`, `/lynx`, `/cli` (+ `/cli/codegen`).

## How it fits together

`scriptcable build` compiles your `src/core.ts` through scriptc into a shared library (and optionally WASM), writes a type-safe client into `.scriptcable/generated`, and links it as `@unikit-bridge/scriptcable-client` in `node_modules` — every resolver (bundler graphs, Bun/Node runtimes, the TS server) sees the same bare specifier.

Source and docs: [github.com/loopy-lim/scriptcable](https://github.com/loopy-lim/scriptcable)
