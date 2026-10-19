import { doctor } from '@scriptca/core';
export async function runDoctor(cwd = process.cwd()) {
    try {
        const info = await doctor(cwd);
        console.log('scriptca doctor');
        console.log(`  node:     ${info.nodeVersion}`);
        console.log(`  scriptc:  ${info.version} (${info.scriptcBin})`);
        console.log(`  zig:      ${info.hasZig ? info.zigPath : 'MISSING (needed for WASM)'}`);
        console.log(`  clang:    ${info.hasClang ? info.clangPath : 'missing (needed for native .lib.a on Linux)'}`);
        if (!info.hasZig) {
            console.log('\nHint: install zig 0.13.x for WASM builds (0.14 breaks WASI with scriptc 0.3.x).');
            return 1;
        }
        console.log('\nOK — ready to build.');
        return 0;
    }
    catch (e) {
        console.error(String(e));
        return 1;
    }
}
//# sourceMappingURL=doctor.js.map