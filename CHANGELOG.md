# Changelog

## 0.1.0 — 2026-10-19

### Added
- Monorepo: `@scriptca/{types,core,cli,node,bun,tauri,react-native,lynx,vite,next,webpack,testing}`
- Native-default builds: scriptc `.lib.a` → `lib{name}.so` (Node/Bun) + self-contained `lib{name}.a` (Rust/C++)
- WASM opt-in with bundled minimal WASI polyfill (`@scriptca/core/wasi`)
- Rust crates `scriptca-sys` / `scriptca-tauri` linking the static archive
- React Native & Lynx C++ hosts (CMake) + iOS podspec / Android JNI stubs
- Vite / Next / Webpack(Rspack) plugins; `scriptca init --host …`
- Contract gate: `scriptca diff`
- Examples for Node, Bun, Vite, Next, Tauri, RN, Lynx

### Notes
- Full Tauri webview `tauri build`, RN device builds, and Lynx Explorer remain host-toolchain dependent
