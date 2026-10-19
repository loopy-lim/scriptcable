import { doctor } from '@scriptca/core';

export async function runDoctor(cwd = process.cwd()): Promise<number> {
  try {
    const info = await doctor(cwd);
    console.log('scriptca doctor');
    console.log(`  node:     ${info.nodeVersion}`);
    console.log(`  scriptc:  ${info.version} (${info.scriptcBin})`);
    console.log(`  clang:    ${info.hasClang ? info.clangPath : 'MISSING (required for native default)'}`);
    console.log(`  zig:      ${info.hasZig ? info.zigPath : 'missing (only needed for --target wasm)'}`);
    if (!info.hasClang) {
      console.log('\nHint: install clang to link the native shared library (default build).');
      console.log('  Linux: sudo apt install clang');
      console.log('  macOS: xcode-select --install');
      return 1;
    }
    console.log('\nOK — ready to build native cores.');
    if (!info.hasZig) {
      console.log('(Optional) install zig 0.13.x if you need WASM fallback for browsers.');
    }
    return 0;
  } catch (e) {
    console.error(String(e));
    return 1;
  }
}
