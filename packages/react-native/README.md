# @scriptca/react-native

```ts
import { createReactNativeEngine, createMockBridge } from '@scriptca/react-native';

// Dev / tests
const engine = createReactNativeEngine(
  createMockBridge({ add: (a, b) => Number(a) + Number(b) }),
);

// Production: implement ReactNativeBridge on top of your Nitro/JSI module
// that links the scriptc native archive (see scriptc iOS/Android library targets).
```
