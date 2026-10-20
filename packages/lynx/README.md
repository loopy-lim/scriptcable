# @scriptcable/lynx

**Native-first on device:** link the scriptc archive into your own Lynx
native module (NDK / platform build). Use `ScriptcableRspackPlugin`
(`@scriptcable/webpack`) so Rspeedy/Rsbuild rebuilds the core, then bridge
through `createLynxEngine`.

WASM is an opt-in fallback for hosts without a native linker.
