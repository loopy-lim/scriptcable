# Tauri example (native)

Links the scriptca/scriptc native shared library into Rust via `scriptca-sys`,
then exposes invoke-style commands through `scriptca-tauri`.

```bash
pnpm --filter @scriptca/example-calculator-core build   # produces calculator.so
cargo test -p scriptca-sys
cargo run -p scriptca-tauri-example
```

A full `tauri build` (webview + bundler) needs the Tauri CLI and a WebView on
the host; this example verifies the **native FFI path** that a Tauri `build.rs`
would use.
