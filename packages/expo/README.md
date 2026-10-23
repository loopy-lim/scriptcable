# @scriptcable/expo

Expo config plugin — wires the generated scriptcable Android bridge into the
prebuilt project automatically. No hand-written native module, no CMake.

## Usage

```bash
scriptcable build --hosts react-native     # JS spec + Kotlin module
scriptcable build --platform android       # prebuilt bridge .so (android-arm64)
```

```json
// app.json
{ "expo": { "plugins": ["@scriptcable/expo"] } }
```

```bash
bunx expo prebuild -p android
cd android && ./gradlew assembleDebug
```

The plugin copies the prebuilt `lib{name}_cable.so` (jniLibs + assets for
ARM-translation devices), the Kotlin module + package, registers
`CablePackage` in MainApplication, flips `expo.useLegacyPackaging`, and
copies the generated `NativeCable.ts` into `src/`.

⚠️ Never add an app-level `externalNativeBuild` — RN 0.88's gradle plugin
injects its own cmake that builds `libappmodules.so` (the core TurboModule
bindings); a second block replaces the path and the app dies at launch.

Verified end-to-end on an Android 14 emulator: RN JS → TurboModule interop →
Kotlin → JNI → C++ dispatch → the compiled core (`CABLE_RESULT:{"sum":42}`).
