import { doctor } from '@scriptca/core';

export async function runDoctor(cwd = process.cwd()): Promise<number> {
  try {
    const info = await doctor(cwd);
    console.log('scriptca doctor');
    console.log(`  node:     ${info.nodeVersion}`);
    console.log(`  scriptc:  ${info.version} (${info.scriptcBin})`);
    console.log(`  platform: ${process.platform}/${process.arch}`);
    console.log(`  clang:    ${info.hasClang ? info.clangPath : 'MISSING (required for native default)'}`);
    console.log(`  zig:      ${info.hasZig ? info.zigPath : 'missing (only for --target wasm / cross)'}`);
    if (!info.hasClang) {
      console.log('\nFix clang:');
      console.log('  Linux:  sudo apt install clang');
      console.log('  macOS:  xcode-select --install');
      return 1;
    }
    console.log('\nOK — ready to build native cores.');
    console.log('Apple Silicon (M1/M2/M3): host builds are arm64 by default.');
    console.log('  iOS device lib:   SCRIPTC_TARGET=aarch64-apple-ios scriptca build --target native');
    console.log('  iOS simulator:    SCRIPTC_TARGET=aarch64-apple-ios-simulator …');
    console.log('  Android arm64:    SCRIPTC_TARGET=aarch64-linux-android … (needs NDK + zig)');
    console.log('  WASM (browser):   scriptca build --target wasm   # needs zig 0.13.x');
    return 0;
  } catch (e) {
    console.error(String(e));
    return 1;
  }
}
