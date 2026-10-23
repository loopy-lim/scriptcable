/**
 * Wire the generated native host into the expo-prebuilt android project.
 * Idempotent — safe to re-run after every `expo prebuild` / core rebuild:
 *   bunx expo prebuild -p android --no-install
 *   bun scripts/wire-android.mjs
 *   cd android && ./gradlew assembleDebug
 *
 * The bridge .so is PREBUILT by `scriptcable build --platform android`
 * (JNI + dispatch + statically-linked scriptc archive) — it ships as a
 * jniLib, so no app-level CMake is added. IMPORTANT: never add an
 * `externalNativeBuild` block to app/build.gradle — RN 0.88's gradle
 * plugin injects its own (it builds libappmodules.so, which registers the
 * core TurboModules); a second block replaces the plugin's path and the
 * app dies with "'PlatformConstants' could not be found".
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const android = join(root, 'android');
const gen = join(root, '.scriptcable', 'generated', 'android');
const soSource = join(root, '.scriptcable', 'android-arm64', 'libcalculator.so');

if (!existsSync(android)) throw new Error('android/ missing — run `bunx expo prebuild -p android --no-install` first');
for (const f of ['CableModule.kt', 'CablePackage.kt']) {
  if (!existsSync(join(gen, f))) throw new Error(`generated/android/${f} missing — run \`bun run build:hosts\` first`);
}
if (!existsSync(soSource)) throw new Error('prebuilt bridge .so missing — run `bun run build:android` first');

// 1) Kotlin module + package
const cablePkg = join(android, 'app', 'src', 'main', 'java', 'com', 'scriptcable', 'cable');
mkdirSync(cablePkg, { recursive: true });
copyFileSync(join(gen, 'CableModule.kt'), join(cablePkg, 'CableModule.kt'));
copyFileSync(join(gen, 'CablePackage.kt'), join(cablePkg, 'CablePackage.kt'));

// 2) The prebuilt bridge .so as a jniLib (arm64 devices)…
const jniLibs = join(android, 'app', 'src', 'main', 'jniLibs', 'arm64-v8a');
mkdirSync(jniLibs, { recursive: true });
copyFileSync(soSource, join(jniLibs, 'libcalculator_cable.so'));
// NOTE: do NOT add an `externalNativeBuild`/`ndk.abiFilters` block to
// app/build.gradle — RN 0.88's gradle plugin injects its own cmake (it
// builds libappmodules.so, the core TurboModule bindings); overriding the
// path kills those bindings ("'PlatformConstants' could not be found").
// For an ARM-translation emulator build the app instead with:
//   ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a

// 3) …and in assets for ARM-translation devices (x86_64 emulator/image):
// the RN runtime stays x86_64, CableModule extracts this and System.loads
// it by absolute path so the native bridge translates the arm64 code.
const assets = join(android, 'app', 'src', 'main', 'assets');
mkdirSync(assets, { recursive: true });
copyFileSync(soSource, join(assets, 'libcalculator_cable.so'));

// 4) The JS side imports './NativeCable' from src/ — metro resolves it
// statically, so the generated spec must sit where the app imports it.
copyFileSync(join(gen, '..', 'NativeCable.ts'), join(root, 'src', 'NativeCable.ts'));

// 5) Register the package in MainApplication (idempotent)
const appKt = join(android, 'app', 'src', 'main', 'java', 'com', 'scriptcable', 'rnexample', 'MainApplication.kt');
let app = readFileSync(appKt, 'utf8');
if (!app.includes('CablePackage')) {
  if (!app.includes('// Packages that cannot be autolinked yet')) {
    throw new Error('MainApplication.kt: unexpected shape — add CablePackage manually');
  }
  app = app.replace(
    '          // Packages that cannot be autolinked yet can be added manually here, for example:\n          // add(MyReactNativePackage())',
    '          // Packages that cannot be autolinked yet can be added manually here, for example:\n          // add(MyReactNativePackage())\n          add(com.scriptcable.cable.CablePackage())',
  );
  writeFileSync(appKt, app);
}

// 6) arm64-only APKs on x86_64 translation devices: SoLoader picks the APK's
// dir by the DEVICE's preferred ABI (x86_64) — with extractNativeLibs=false
// nothing is extracted and the arm64 DSO is never found. The expo template
// ships this property as `false` — flip it.
const props = join(android, 'gradle.properties');
const p = readFileSync(props, 'utf8');
if (!p.includes('expo.useLegacyPackaging=true')) {
  if (!/expo\.useLegacyPackaging\s*=/.test(p)) throw new Error('gradle.properties: expo.useLegacyPackaging missing');
  writeFileSync(props, p.replace(/expo\.useLegacyPackaging=false/, 'expo.useLegacyPackaging=true'));
}

console.log('wire-android OK — bridge .so (jniLibs + assets) and CablePackage wired');
