import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { doctor } from '@scriptcable/core';
import { formatError } from '../errors.js';

/** WSL env vars can be stripped (nested shells, CI) — /proc/version is the
 * reliable signal on Linux. */
function isWsl(): boolean {
  if (process.env.WSL_DISTRO_NAME) return true;
  if (process.platform !== 'linux') return false;
  try {
    // WSL1 reports "…-Microsoft" (capital M); WSL2 is lowercase.
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

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
    // Match the native-link gate: clang OR gcc's cc links the shared library,
    // with the provisioned zig cc as the clang-less fallback.
    const linkerOk = info.hasClang || info.hasCc || info.hasZig;
    const linker = info.hasClang
      ? `${info.clangPath} ✓`
      : info.hasCc
        ? `${info.ccPath} ✓ (gcc cc)`
        : info.hasZig
          ? `${info.zigPath} ✓ (zig cc fallback)`
          : 'MISSING (required for native default)';
    console.log(`  linker:   ${linker}`);
    console.log(
      `  zig:      ${
        info.hasZig
          ? `${info.zigPath} ✓`
          : 'missing — auto-provisions 0.13.x on the first wasm/cross build (SCRIPTCABLE_NO_AUTO_TOOLS=1 disables)'
      }`,
    );
    console.log(
      `  deno:     ${
        info.hasDeno
          ? `${info.denoPath} ✓`
          : 'missing (only for the generated deno flavor — CI covers deno-app; `bun install -g deno` adds it)'
      }`,
    );
    if (!linkerOk) {
      console.log('\nFix the linker:');
      console.log('  Linux:  sudo apt install clang    # gcc (cc) alone is enough too');
      console.log('  macOS:  xcode-select --install');
      console.log('  or:     run a wasm build once — the auto-provisioned zig cc then links hosts too');
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
        // CI durability: the file: dep only survives when its placeholder
        // manifest is committed, so report rather than auto-write — `init`
        // scaffolds the dep + placeholder + gitignore negations as a set.
        try {
          const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
          };
          const declared = { ...pkg.dependencies, ...pkg.devDependencies }['@scriptcable/client'];
          if (declared !== 'file:.scriptcable/generated') {
            console.log('  client-dep: not CI-durable — add to package.json to survive re-installs:');
            console.log('              "@scriptcable/client": "file:.scriptcable/generated"  (init scaffolds this)');
          }
        } catch {
          /* no package.json here — nothing to advise */
        }
      }
    }
    console.log('\nOK — ready to build native cores.');
    console.log('  repeat builds are cached in .scriptcable/build-cache.json (scriptcable build --force to bypass)');
    if (isWsl()) {
      console.log(
        `WSL (${process.env.WSL_DISTRO_NAME ?? 'detected via /proc'}): GUI hosts (Electron) may need system libs — on sudo-less setups,` +
          ' `apt-get download` + `dpkg -x` into a user dir and export LD_LIBRARY_PATH; WSLg provides DISPLAY.',
      );
    }
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
