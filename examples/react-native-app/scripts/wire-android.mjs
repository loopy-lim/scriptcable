/**
 * Wire the generated native host into the expo-prebuilt android project.
 * Idempotent — safe to re-run after every `expo prebuild` / core rebuild:
 *   bunx expo prebuild -p android --no-install
 *   bun scripts/wire-android.mjs
 *   cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const android = join(root, 'android');
const gen = join(root, '.scriptcable', 'generated', 'android');

if (!existsSync(android)) throw new Error('android/ missing — run `bunx expo prebuild -p android --no-install` first');
for (const f of ['cable_host.cpp', 'cable_host.h', 'cable_jni.cpp', 'cable-version.map', 'CableModule.kt', 'CablePackage.kt']) {
  if (!existsSync(join(gen, f))) {
    throw new Error(`generated/android/${f} missing — run \`bun run build:hosts\` first`);
  }
}

// 1) C++ + JNI into the app's jni dir
const jni = join(android, 'app', 'src', 'main', 'jni');
mkdirSync(jni, { recursive: true });
for (const f of ['cable_host.cpp', 'cable_host.h', 'cable_jni.cpp', 'cable-version.map', 'dummy_abi.cpp']) {
  copyFileSync(join(gen, f), join(jni, f));
}
// Hybrid packaging: the RN runtime runs as the device's preferred ABI, the
// scriptc bridge .so (arm64-only) rides in assets/ and CableModule extracts
// + loads it by absolute path on ARM-translation devices.
const assets = join(android, 'app', 'src', 'main', 'assets');
mkdirSync(assets, { recursive: true });
copyFileSync(join(root, '.scriptcable', 'android-arm64', 'libcalculator.so'), join(assets, 'libcalculator_cable.so'));
// The generated CMakeLists expects the archive two levels up (generated dir);
// from the app jni dir it's five levels up (jni→main→src→app→android→project).
writeFileSync(
  join(jni, 'CMakeLists.txt'),
  readFileSync(join(gen, 'CMakeLists.txt'), 'utf8').replace(
    'CMAKE_CURRENT_SOURCE_DIR}/../../android-arm64/',
    'CMAKE_CURRENT_SOURCE_DIR}/../../../../../.scriptcable/android-arm64/',
  ),
);

// 2) Kotlin module + package
const cablePkg = join(android, 'app', 'src', 'main', 'java', 'com', 'scriptcable', 'cable');
mkdirSync(cablePkg, { recursive: true });
copyFileSync(join(gen, 'CableModule.kt'), join(cablePkg, 'CableModule.kt'));
copyFileSync(join(gen, 'CablePackage.kt'), join(cablePkg, 'CablePackage.kt'));

// 2b) The JS side imports './NativeCable' from src/ — metro resolves it
// statically, so the generated spec must sit where the app imports it.
copyFileSync(join(gen, '..', 'NativeCable.ts'), join(root, 'src', 'NativeCable.ts'));

// 3) register the package in MainApplication (idempotent)
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

// 4) build the JNI library with the app (idempotent)
const gradle = join(android, 'app', 'build.gradle');
let g = readFileSync(gradle, 'utf8');
if (!g.includes('externalNativeBuild')) {
  if (!g.includes('defaultConfig {') || !g.includes('buildTypes {')) {
    throw new Error('app/build.gradle: unexpected shape');
  }
  g = g.replace(
    'defaultConfig {',
    'defaultConfig {\n        ndk {\n            // x86_64: the RN runtime natively; arm64-v8a: the scriptc bridge\n            // (scriptc archives are arm64-only) — translation devices load it\n            // from assets (see CableModule).\n            abiFilters "arm64-v8a", "x86_64"\n        }',
  );
  // externalNativeBuild lives INSIDE the android block — anchor on buildTypes.
  g = g.replace(
    '    buildTypes {',
    '    externalNativeBuild {\n        cmake {\n            path file(\'src/main/jni/CMakeLists.txt\')\n            version \'3.22.1\'\n        }\n    }\n\n    buildTypes {',
  );
  writeFileSync(gradle, g);
  // arm64-only APKs on x86_64 translation devices: SoLoader picks the APK's
  // dir by the DEVICE's preferred ABI (x86_64) — with extractNativeLibs=false
  // nothing is extracted and the arm64 DSO is never found. The expo template
  // ships this property as `false` — flip it.
  const props = join(android, 'gradle.properties');
  const p = readFileSync(props, 'utf8');
  if (!p.includes('expo.useLegacyPackaging=true')) {
    if (!/expo\.useLegacyPackaging\s*=/.test(p)) throw new Error('gradle.properties: expo.useLegacyPackaging missing');
    writeFileSync(props, p.replace(/expo\.useLegacyPackaging=false/, 'expo.useLegacyPackaging=true'));
  }
  writeFileSync(gradle, g);
}

console.log('wire-android OK — cable module wired into android/');
