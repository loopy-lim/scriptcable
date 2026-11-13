# @scriptca/core

Core utilities for scriptca:

- `configToProfile` — turn `scriptca.json` into a scriptc library profile
- `buildCore` / `doctor` / `resolveScriptc` — locate & invoke the scriptc toolchain
- `loadWasmModule` / `loadWasmFile` — WASI Preview 1 reactor loader with ABI marshalling
- `snapshotFromConfig` / `diffContracts` — CI contract gates
