import { doctor } from '@scriptcable/core';
import { formatError } from '../errors.js';

export async function runDoctor(cwd = process.cwd()): Promise<number> {
  try {
    const info = await doctor(cwd);
    console.log('scriptcable doctor');
    if (info.runtime === 'bun') {
      console.log(`  bun:      ${info.bunVersion} ✓`);
    } else {
      console.log(`  node:     ${info.nodeVersion} (fallback — Bun is the default engine)`);
    }
    console.log(`  scriptc:  ${info.version} (${info.scriptcBin})`);
    console.log(`  platform: ${process.platform}/${process.arch}`);
    console.log(`  clang:    ${info.hasClang ? `${info.clangPath} ✓` : 'MISSING (required for native default)'}`);
    console.log(`  zig:      ${info.hasZig ? `${info.zigPath} ✓` : 'missing (only for --target wasm / cross)'}`);
    if (!info.hasClang) {
      console.log('\nFix clang:');
      console.log('  Linux:  sudo apt install clang');
      console.log('  macOS:  xcode-select --install');
      return 1;
    }
    if (info.clientLink) {
      if (info.clientLink === 'blocked') {
        console.log('  client:   @scriptcable/client link UNAVAILABLE');
        console.log('    Fix: rerun `scriptcable build`, or add `"@scriptcable/client": "file:.scriptcable/generated"`');
        console.log('    to dependencies and reinstall for a CI-durable link.');
      } else {
        const verb = info.clientLink === 'current' ? '✓' : '✓ (repaired)';
        console.log(`  client:   @scriptcable/client → node_modules ${verb}`);
      }
    }
    console.log('\nOK — ready to build native cores.');
    console.log('  repeat builds are cached in .scriptcable/build-cache.json (scriptcable build --force to bypass)');
    console.log('Apple Silicon (M1/M2/M3): host builds are arm64 by default.');
    console.log('  iOS device lib:   SCRIPTC_TARGET=aarch64-apple-ios scriptcable build --target native');
    console.log('  iOS simulator:    SCRIPTC_TARGET=aarch64-apple-ios-simulator …');
    console.log('  Android arm64:    SCRIPTC_TARGET=aarch64-linux-android … (needs NDK + zig)');
    console.log('  WASM (browser):   scriptcable build --target wasm   # needs zig 0.13.x');
    return 0;
  } catch (e) {
    console.error(formatError(e));
    return 1;
  }
}
