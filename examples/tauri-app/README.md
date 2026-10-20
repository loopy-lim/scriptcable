# Tauri example (native)

`scriptcable build` produces `libcalculator.a` + `libcalculator.dylib`.
In your own Tauri app, link the archive from a Rust build script and expose
`#[tauri::command]`s that call the C ABI symbols (`calc_add`, `calc_greet`, …).

This example verifies the **webview bridge contract**
(`createTauriSidecarEngine`) that the Tauri shell implements:

```bash
bun run test    # builds the core, runs the bridge test
```

A full `tauri build` (webview + bundler) needs the Tauri CLI and a WebView on
the host — the native FFI path lives in the Tauri app, not this repo.
