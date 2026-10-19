# @scriptca/tauri

Two integration modes:

1. **Webview WASM** (recommended for plug-and-play): `scriptca build --hosts tauri` and load the `.wasm` in the frontend with a WASI polyfill.
2. **Sidecar / IPC**: `createTauriSidecarEngine({ invoke, profile })` — Rust side hosts native `.lib.a` or a scriptc executable.

```ts
import { createTauriSidecarEngine } from '@scriptca/tauri';
import { invoke } from '@tauri-apps/api/core';

const engine = createTauriSidecarEngine({ invoke, profile });
await engine.invoke('add', [20, 22]);
```
