import { spawn } from 'node:child_process';
import { access, constants, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { ScriptcaToolchainError } from '@scriptca/types';
import type { ScriptcaConfig, ScriptcaProfile } from '@scriptca/types';
import { configToProfile } from './profile.js';
import { linkSharedLibrary, sharedLibraryFileName, buildCompleteStaticArchive } from './link-shared.js';

export type ToolchainInfo = {
  scriptcBin: string;
  version: string;
  nodeVersion: string;
  hasZig: boolean;
  hasClang: boolean;
  zigPath?: string;
  clangPath?: string;
};

async function which(cmd: string): Promise<string | undefined> {
  return new Promise((resolvePromise) => {
    const child = spawn('which', [cmd], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('close', (code) => resolvePromise(code === 0 ? out.trim() || undefined : undefined));
  });
}

async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

async function tryResolveScriptcFrom(dir: string): Promise<string | undefined> {
  try {
    const require = createRequire(join(dir, 'package.json'));
    const pkg = dirname(require.resolve('scriptc/package.json'));
    // Prefer the published bin shim
    for (const candidate of [
      join(pkg, 'bin', 'scriptc.js'),
      join(pkg, 'bin', 'scriptc'),
      join(dir, 'node_modules', '.bin', 'scriptc'),
    ]) {
      try {
        await access(candidate, constants.R_OK);
        return candidate;
      } catch {
        /* try next */
      }
    }
  } catch {
    /* not found here */
  }
  return undefined;
}

/** Resolve scriptc binary: walk up from cwd, then PATH, then auto-install. */
export async function resolveScriptc(cwd = process.cwd()): Promise<string> {
  let dir = resolve(cwd);
  for (let i = 0; i < 8; i++) {
    const hit = await tryResolveScriptcFrom(dir);
    if (hit) return hit;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const onPath = await which('scriptc');
  if (onPath) return onPath;

  const install = await run('npm', ['install', '--save-dev', 'scriptc@^0.3.6'], { cwd });
  if (install.code !== 0) {
    throw new ScriptcaToolchainError(
      'scriptc is not installed and auto-install failed.',
      'Install Node.js >= 24, then run: npm install -D scriptc\n' +
        'Keep install scripts enabled (npm needs them for the native compiler).\n' +
        'In a pnpm workspace, add scriptc to the package that runs the build.\n' +
        install.stderr.slice(0, 500),
    );
  }
  return resolveScriptc(cwd);
}

export async function scriptcVersion(bin: string): Promise<string> {
  const r = await run(process.execPath, [bin, '--version']);
  if (r.code !== 0) {
    // bin may be a native binary
    const r2 = await run(bin, ['--version']);
    if (r2.code !== 0) throw new ScriptcaToolchainError(`scriptc --version failed: ${r2.stderr}`);
    return r2.stdout.trim();
  }
  return r.stdout.trim();
}

export async function doctor(cwd = process.cwd()): Promise<ToolchainInfo> {
  const nodeVersion = process.version;
  const major = Number(nodeVersion.slice(1).split('.')[0]);
  if (major < 24) {
    throw new ScriptcaToolchainError(
      `Node.js ${nodeVersion} is too old (scriptc requires >= 24).`,
      'Install Node 24+: https://nodejs.org/ or `nvm install 24`',
    );
  }

  let scriptcBin: string;
  try {
    scriptcBin = await resolveScriptc(cwd);
  } catch (e) {
    throw e;
  }

  const version = await scriptcVersion(scriptcBin);
  const zigPath = (await which('zig')) ?? undefined;
  const clangPath = (await which('clang')) ?? undefined;

  return {
    scriptcBin,
    version,
    nodeVersion,
    hasZig: Boolean(zigPath),
    hasClang: Boolean(clangPath),
    zigPath,
    clangPath,
  };
}

export type BuildOptions = {
  cwd?: string;
  /** wasm | native | both */
  target?: 'wasm' | 'native' | 'both';
  outDir?: string;
  env?: NodeJS.ProcessEnv;
};

export type BuildResult = {
  profilePath: string;
  wasmPath?: string;
  /** Static archive from scriptc (.lib.a) */
  nativePath?: string;
  /** Loadable shared library linked from the archive (.so/.dylib/.dll) */
  sharedPath?: string;
  profile: ScriptcaProfile;
};

async function ensureRuntimePack(cwd: string, target: 'wasm' | 'native'): Promise<void> {
  if (target !== 'wasm') return;
  const require = createRequire(join(cwd, 'package.json'));
  try {
    require.resolve('@scriptc/runtime-wasm32-wasi/package.json');
    return;
  } catch {
    const info = await doctor(cwd);
    const ver = info.version.replace(/^v/, '');
    const r = await run(
      'npm',
      ['install', '--save-dev', `@scriptc/runtime-wasm32-wasi@${ver}`],
      { cwd },
    );
    if (r.code !== 0) {
      throw new ScriptcaToolchainError(
        'Failed to install @scriptc/runtime-wasm32-wasi (required for WASM builds).',
        r.stderr.slice(0, 500) +
          '\nAlso install zig 0.13.x on PATH: https://ziglang.org/download/',
      );
    }
  }
}

function scriptcInvoke(
  bin: string,
  args: string[],
): { cmd: string; args: string[] } {
  // Prefer running via node if it's a .js entry
  if (bin.endsWith('.js') || bin.endsWith('.mjs')) {
    return { cmd: process.execPath, args: [bin, ...args] };
  }
  return { cmd: bin, args };
}

export async function buildCore(
  config: ScriptcaConfig,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const outDir = resolve(cwd, options.outDir ?? config.outDir ?? '.scriptca');
  const target = options.target ?? config.target ?? 'native';
  await mkdir(outDir, { recursive: true });

  const info = await doctor(cwd);
  const profile = configToProfile(config);
  const profilePath = join(outDir, 'profile.json');
  // scriptc resolves profile.entry relative to the profile file
  const entryAbs = resolve(cwd, config.entry);
  profile.entry = relative(outDir, entryAbs).replace(/\\/g, '/');
  await writeFile(profilePath, JSON.stringify(profile, null, 2) + '\n');

  const result: BuildResult = { profilePath, profile };

  const runBuild = async (kind: 'wasm' | 'native') => {
    if (kind === 'wasm') {
      if (!info.hasZig) {
        throw new ScriptcaToolchainError(
          'zig is required for WASM (wasm32-wasi) library builds.',
          'Install zig 0.13.x and put it on PATH.\n' +
            '  curl -fsSL https://ziglang.org/download/0.13.0/zig-linux-x86_64-0.13.0.tar.xz | tar -xJ\n' +
            'Note: zig 0.14 currently fails WASI builds with scriptc 0.3.x — use 0.13.',
        );
      }
      await ensureRuntimePack(cwd, 'wasm');
    } else if (!info.hasClang && process.platform === 'linux') {
      throw new ScriptcaToolchainError(
        'clang is required for native library builds on Linux.',
        'Install clang (e.g. `sudo apt install clang`) or use target: "wasm".',
      );
    }

    const outName = kind === 'wasm' ? `${config.name}.wasm` : `${config.name}.lib.a`;
    const outPath = join(outDir, outName);
    const args = ['build', '--lib', '--profile', profilePath, '-o', outPath];
    const inv = scriptcInvoke(info.scriptcBin, args);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...options.env,
      ...(kind === 'wasm' ? { SCRIPTC_TARGET: 'wasm32-wasi' } : {}),
    };
    const r = await run(inv.cmd, inv.args, { cwd, env });
    if (r.code !== 0) {
      throw new ScriptcaToolchainError(
        `scriptc ${kind} build failed:\n${r.stderr || r.stdout}`,
        'Run `scriptca doctor` and `scriptc coverage <entry>` for details.',
      );
    }
    return outPath;
  };

  if (target === 'wasm' || target === 'both') {
    result.wasmPath = await runBuild('wasm');
  }
  if (target === 'native' || target === 'both') {
    result.nativePath = await runBuild('native');
    result.sharedPath = await linkSharedLibrary({
      archivePath: result.nativePath!,
      outPath: join(outDir, sharedLibraryFileName(config.name)),
      cwd,
    });
    // Self-contained static archive for Rust/C++ (includes promise stubs)
    await buildCompleteStaticArchive({
      archivePath: result.nativePath!,
      outPath: join(outDir, `lib${config.name}.a`),
    });
  }

  // Persist contract snapshot beside artifacts
  const { snapshotFromProfile } = await import('./contract.js');
  const snap = snapshotFromProfile(profile);
  await writeFile(join(outDir, 'contract.json'), JSON.stringify(snap, null, 2) + '\n');

  return result;
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
