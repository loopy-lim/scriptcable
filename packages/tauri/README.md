# @scriptca/tauri

**Native-first:** link `scriptca build`’s `.lib.a` from Rust (`cc` / `build.rs`) and
expose each export via Tauri commands. Use `createTauriSidecarEngine({ invoke, profile })`.

```ts
import { createTauriSidecarEngine } from '@scriptca/tauri';
import { invoke } from '@tauri-apps/api/core';

const engine = createTauriSidecarEngine({ invoke, profile });
await engine.invoke('add', [20, 22]);
```

Webview WASM is opt-in for prototypes that cannot link native code yet.
