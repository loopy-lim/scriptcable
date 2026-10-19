# @scriptca/react-native

**Native-first:** link the scriptc `.lib.a` (or iOS/Android library archives from
`SCRIPTC_TARGET=aarch64-apple-ios` / `aarch64-linux-android`) into a Nitro / JSI /
TurboModule host, then wrap it with `createReactNativeEngine`.

```ts
import { createReactNativeEngine, createMockBridge } from '@scriptca/react-native';

// Tests / Storybook
const engine = createReactNativeEngine(
  createMockBridge({ add: (a, b) => Number(a) + Number(b) }),
);

// Production: bridge.call → native module that links calculator.lib.a
```

WASM-on-RN is an opt-in fallback only (not the default).
