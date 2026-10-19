# @scriptca/lynx

**Native-first on device:** link the scriptc archive into a Lynx native module.
Use `ScriptcaRspackPlugin` (`@scriptca/webpack`) so Rspeedy/Rsbuild rebuilds the
core, then bridge through `createLynxEngine`.

WASM is an opt-in fallback for hosts without a native linker.
