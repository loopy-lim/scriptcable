# @scriptcable/tauri

**Native-first:** link `scriptcable build`'s `lib{name}.a` inside your own Tauri
Rust shell (build script / `cc`) and wrap the C ABI symbols with
`#[tauri::command]`. Bridge from the webview with
`createTauriSidecarEngine({ invoke, profile })`.

```ts
import { createTauriSidecarEngine } from '@scriptcable/tauri';
import { invoke } from '@tauri-apps/api/core';

const engine = createTauriSidecarEngine({ invoke, profile });
await engine.invoke('add', [20, 22]);
```

Webview WASM is opt-in for prototypes that cannot link native code yet.
