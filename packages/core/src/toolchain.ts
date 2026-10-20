import { spawn } from 'node:child_process';
import { access, constants, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { ScriptcableToolchainError } from '@scriptcable/types';
import type { ScriptcableConfig, ScriptcableProfile } from '@scriptcable/types';
import { configToProfile } from './profile.js';
import { linkSharedLibrary, sharedLibraryFileName, buildCompleteStaticArchive } from './link-shared.js';

export type ToolchainInfo = {
  scriptcBin: string;
  version: string;
  /** JS runtime driving the toolchain — Bun is the default engine. */
  runtime: 'bun' | 'node';
  nodeVersion: string;
  bunVersion?: string;
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

/** Resolve scriptc binary: walk up from cwd, then PATH, then auto-install with bun. */
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

  const install = await run('bun', ['add', '--dev', 'scriptc@^0.3.6'], { cwd });
  if (install.code !== 0) {
    throw new ScriptcableToolchainError(
      'scriptc is not installed and auto-install failed.',
      'Install Bun 1.2+ (https://bun.sh), then run: bun add -d scriptc\n' +
        'Bun runs scriptc install scripts for trusted deps; keep them enabled.\n' +
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
    if (r2.code !== 0) throw new ScriptcableToolchainError(`scriptc --version failed: ${r2.stderr}`);
    return r2.stdout.trim();
  }
  return r.stdout.trim();
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function doctor(cwd = process.cwd()): Promise<ToolchainInfo> {
  const nodeVersion = process.version;
  const bunVersion = process.versions.bun;
  const runtime: 'bun' | 'node' = bunVersion ? 'bun' : 'node';

  // Bun is the primary engine; plain Node >= 24 is still accepted for adapters.
  if (runtime === 'bun' && compareVersions(bunVersion, '1.2.0') < 0) {
    throw new ScriptcableToolchainError(
      `Bun ${bunVersion} is too old (scriptcable requires >= 1.2.0).`,
      'Upgrade: curl -fsSL https://bun.sh/install | bash',
    );
  }
  if (runtime === 'node') {
    const major = Number(nodeVersion.slice(1).split('.')[0]);
    if (major < 24) {
      throw new ScriptcableToolchainError(
        `Node.js ${nodeVersion} is too old (scriptc requires >= 24).`,
        'Prefer Bun (https://bun.sh) or install Node 24+: https://nodejs.org/',
      );
    }
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
    runtime,
    nodeVersion,
    bunVersion,
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
  /** Bypass the build cache (default: false — cached hits skip scriptc + link) */
  force?: boolean;
};

export type BuildResult = {
  profilePath: string;
  wasmPath?: string;
  /** Static archive from scriptc (.lib.a) */
  nativePath?: string;
  /** Loadable shared library linked from the archive (.so/.dylib/.dll) */
  sharedPath?: string;
  profile: ScriptcableProfile;
  /** True when this result came from the build cache (no recompile) */
  cached?: boolean;
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
      'bun',
      ['add', '--dev', `@scriptc/runtime-wasm32-wasi@${ver}`],
      { cwd },
    );
    if (r.code !== 0) {
      throw new ScriptcableToolchainError(
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
  // Prefer running via the JS engine if it's a .js entry (works under bun and node)
  if (bin.endsWith('.js') || bin.endsWith('.mjs')) {
    return { cmd: process.execPath, args: [bin, ...args] };
  }
  return { cmd: bin, args };
}

export async function buildCore(
  config: ScriptcableConfig,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const outDir = resolve(cwd, options.outDir ?? config.outDir ?? '.scriptcable');
  const target = options.target ?? config.target ?? 'native';
  await mkdir(outDir, { recursive: true });

  const info = await doctor(cwd);
  // Infer exports from the TS entry when not declared in scriptcable.json.
  const { resolveProfile } = await import('./profile.js');
  const { profile, inferred, skipped } = await resolveProfile(config, cwd);
  if (inferred) {
    console.log(`  inferred:  ${profile.exports.length} exports from ${config.entry} (no scriptcable.json exports declared)`);
    for (const s of skipped) {
      console.log(`  skipped:   ${s.name} — ${s.reason}`);
    }
  }
  const profilePath = join(outDir, 'profile.json');
  // scriptc resolves profile.entry relative to the profile file
  const entryAbs = resolve(cwd, config.entry);
  profile.entry = relative(outDir, entryAbs).replace(/\\/g, '/');
  // scriptc rejects unknown fields (paramNames/doc are codegen-only metadata)
  const scriptcProfile = {
    ...profile,
    exports: profile.exports.map(({ paramNames: _pn, doc: _doc, ...e }) => e),
  };
  await writeFile(profilePath, JSON.stringify(scriptcProfile, null, 2) + '\n');

  const result: BuildResult = { profilePath, profile };

  // — build cache: skip scriptc + link when inputs are unchanged —
  const { computeBuildHash, isCachedBuild, markBuildDone } = await import('./build-cache.js');
  const configInputs = [join(cwd, 'scriptcable.config.ts'), join(cwd, 'scriptcable.json')]
    .filter((p) => p.startsWith(outDir) === false);
  const buildHash = await computeBuildHash({ cwd, config, profile, target, extraInputs: configInputs });
  const wantedArtifacts =
    target === 'wasm'
      ? [join(outDir, `${config.name}.wasm`)]
      : target === 'both'
        ? [join(outDir, `${config.name}.wasm`), join(outDir, sharedLibraryFileName(config.name))]
        : [join(outDir, sharedLibraryFileName(config.name))];
  const cacheHit =
    options.force !== true &&
    (await isCachedBuild({ outDir, target, hash: buildHash, artifactPaths: wantedArtifacts }));

  if (cacheHit) {
    if (target === 'wasm' || target === 'both') {
      result.wasmPath = join(outDir, `${config.name}.wasm`);
    }
    if (target === 'native' || target === 'both') {
      result.nativePath = join(outDir, `${config.name}.lib.a`);
      result.sharedPath = join(outDir, sharedLibraryFileName(config.name));
    }
    result.cached = true;
    return result;
  }

  const runBuild = async (kind: 'wasm' | 'native') => {
    if (kind === 'wasm') {
      if (!info.hasZig) {
        throw new ScriptcableToolchainError(
          'zig is required for WASM (wasm32-wasi) library builds.',
          'Install zig 0.13.x and put it on PATH.\n' +
            '  curl -fsSL https://ziglang.org/download/0.13.0/zig-linux-x86_64-0.13.0.tar.xz | tar -xJ\n' +
            'Note: zig 0.14 currently fails WASI builds with scriptc 0.3.x — use 0.13.',
        );
      }
      await ensureRuntimePack(cwd, 'wasm');
    } else if (!info.hasClang && process.platform === 'linux') {
      throw new ScriptcableToolchainError(
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
      throw new ScriptcableToolchainError(
        `scriptc ${kind} build failed:\n${r.stderr || r.stdout}`,
        'Run `scriptcable doctor` and `scriptc coverage <entry>` for details.',
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
    // Self-contained static archive for hosts that link natively (Tauri/RN/Lynx)
    await buildCompleteStaticArchive({
      archivePath: result.nativePath!,
      outPath: join(outDir, `lib${config.name}.a`),
    });
  }

  await markBuildDone({ outDir, target, hash: buildHash });

  // Persist contract snapshot beside artifacts
  const { snapshotFromProfile } = await import('./contract.js');
  const snap = snapshotFromProfile(profile);
  await writeFile(join(outDir, 'contract.json'), JSON.stringify(snap, null, 2) + '\n');

  return result;
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
