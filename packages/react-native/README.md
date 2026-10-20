# @scriptcable/react-native

**Native-first:** link the scriptc `.lib.a` (or iOS/Android library archives
from `SCRIPTC_TARGET=aarch64-apple-ios` / `aarch64-linux-android`) into your
own native module (Xcode / NDK CMake), then wrap it with
`createReactNativeEngine`.

```ts
import { createReactNativeEngine, createMockBridge } from '@scriptcable/react-native';

// Tests / Storybook
const engine = createReactNativeEngine(
  createMockBridge({ add: (a, b) => Number(a) + Number(b) }),
);

// Production: bridge.call → your native module that links calculator.lib.a
```

WASM-on-RN is an opt-in fallback only (not the default).
