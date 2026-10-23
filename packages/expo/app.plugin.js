/**
 * Expo config plugin — wires the generated scriptcable Android bridge into
 * the prebuilt project automatically. Add it AFTER running
 * `scriptcable build --hosts react-native --platform android`:
 *
 *   // app.json
 *   { "expo": { "plugins": ["@scriptcable/expo"] } }
 *
 * `expo prebuild` then copies the bridge .so (jniLibs + assets for
 * ARM-translation devices), the Kotlin module, and the package
 * registration into android/ — no hand-written native module.
 *
 * Requires the generated artifacts to exist first:
 *   scriptcable build --hosts react-native          (JS spec + Kotlin module)
 *   scriptcable build --platform android            (prebuilt bridge .so)
 */
const { withDangerousMod, withPlugins } = require('@expo/config-plugins');
const { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

function copyBridge(projectRoot, platformDir) {
  const generated = join(projectRoot, '.scriptcable', 'generated', 'android');
  const so = join(projectRoot, '.scriptcable', 'android-arm64', 'libcalculator.so');
  for (const f of ['CableModule.kt', 'CablePackage.kt']) {
    if (!existsSync(join(generated, f))) {
      throw new Error(
        `scriptcable: generated/android/${f} missing — run \`scriptcable build --hosts react-native\` first`,
      );
    }
  }
  if (!existsSync(so)) {
    throw new Error(
      'scriptcable: prebuilt bridge .so missing — run `scriptcable build --platform android` first',
    );
  }

  const cablePkg = join(platformDir, 'app', 'src', 'main', 'java', 'com', 'scriptcable', 'cable');
  mkdirSync(cablePkg, { recursive: true });
  copyFileSync(join(generated, 'CableModule.kt'), join(cablePkg, 'CableModule.kt'));
  copyFileSync(join(generated, 'CablePackage.kt'), join(cablePkg, 'CablePackage.kt'));

  const jniLibs = join(platformDir, 'app', 'src', 'main', 'jniLibs', 'arm64-v8a');
  mkdirSync(jniLibs, { recursive: true });
  copyFileSync(so, join(jniLibs, 'libcalculator_cable.so'));

  const assets = join(platformDir, 'app', 'src', 'main', 'assets');
  mkdirSync(assets, { recursive: true });
  copyFileSync(so, join(assets, 'libcalculator_cable.so'));

  // The JS side imports './NativeCable' from src/ — metro resolves it
  // statically, so the generated spec must sit where the app imports it.
  const nativeCable = join(projectRoot, '.scriptcable', 'generated', 'NativeCable.ts');
  if (existsSync(nativeCable)) {
    const srcDir = join(projectRoot, 'src');
    if (existsSync(srcDir)) copyFileSync(nativeCable, join(srcDir, 'NativeCable.ts'));
  }

  // Register the package in MainApplication (idempotent)
  const appKt = join(
    platformDir,
    'app',
    'src',
    'main',
    'java',
    ...androidPackage(projectRoot).split('.'),
    'MainApplication.kt',
  );
  if (existsSync(appKt)) {
    let app = readFileSync(appKt, 'utf8');
    if (!app.includes('CablePackage')) {
      app = app.replace(
        /( *)\/\/ Packages that cannot be autolinked yet can be added manually here, for example:\n( *)\/\/ add\(MyReactNativePackage\(\)\)/,
        '$1// Packages that cannot be autolinked yet can be added manually here, for example:\n$1// add(MyReactNativePackage())\n$1add(com.scriptcable.cable.CablePackage())',
      );
      writeFileSync(appKt, app);
    }
  }

  // arm64-only APKs on x86_64 translation devices: SoLoader picks the APK's
  // dir by the DEVICE's preferred ABI — with extractNativeLibs=false nothing
  // is extracted and the arm64 DSO is never found. Flip the expo property.
  const props = join(platformDir, 'gradle.properties');
  if (existsSync(props)) {
    const p = readFileSync(props, 'utf8');
    if (!p.includes('expo.useLegacyPackaging=true') && /expo\.useLegacyPackaging\s*=/.test(p)) {
      writeFileSync(props, p.replace(/expo\.useLegacyPackaging=false/, 'expo.useLegacyPackaging=true'));
    }
  }
}

function androidPackage(projectRoot) {
  try {
    const appJson = JSON.parse(readFileSync(join(projectRoot, 'app.json'), 'utf8'));
    return appJson?.expo?.android?.package ?? 'com.scriptcable.cable';
  } catch {
    return 'com.scriptcable.cable';
  }
}

const withScriptcableBridge = (config) =>
  withDangerousMod(config, [
    'android',
    (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformDir = join(projectRoot, 'android');
      if (existsSync(platformDir)) copyBridge(projectRoot, platformDir);
      return modConfig;
    },
  ]);

module.exports = (config) => withPlugins(config, [withScriptcableBridge]);
