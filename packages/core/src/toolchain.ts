import { spawn } from 'node:child_process';
import { access, constants, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path';
import { ScriptcableToolchainError } from '@scriptcable/types';
import type { ResolvedConfig, ScriptcableProfile } from '@scriptcable/types';
import { configToProfile } from './profile.js';
import { generateClients } from './codegen.js';
import { linkSharedLibrary, sharedLibraryFileName, buildCompleteStaticArchive } from './link-shared.js';
import { ensureClientPackageLink } from './client-package.js';
import { buildNodeAddon, canBuildNodeAddon, napiAddonFileName, generateSharedBatchSource, SHARED_BATCH_SYMBOL } from './napi-addon.js';
import { ensureZig, findCachedZig } from './zig-tools.js';
import { which } from './which.js';

export type ToolchainInfo = {
  scriptcBin: string;
  version: string;
  /** JS runtime driving the toolchain — Bun is the default engine. */
  runtime: 'bun' | 'node';
  nodeVersion: string;
  bunVersion?: string;
  hasZig: boolean;
  hasClang: boolean;
  /** gcc's `cc` — linkSharedLibrary accepts it on Linux exactly like clang. */
  hasCc: boolean;
  /** deno on PATH — only needed to run the generated deno flavor locally. */
  hasDeno: boolean;
  zigPath?: string;
  clangPath?: string;
  ccPath?: string;
  denoPath?: string;
  /** State of the `node_modules/@scriptcable/client` link — absent when nothing was generated yet. */
  clientLink?: 'current' | 'linked' | 'repaired' | 'blocked';
};

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
    // Prefer the published bin shim. On Windows the package ships
    // bin/scriptc.exe — an extensionless shim cannot be spawned there
    // (found by the allow-fail Windows CI job).
    const win32 = process.platform === 'win32';
    for (const candidate of [
      ...(win32 ? [join(pkg, 'bin', 'scriptc.exe')] : []),
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

export async function doctor(cwd = process.cwd(), opts: { skipRuntimeGate?: boolean } = {}): Promise<ToolchainInfo> {
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
  // The node >= 24 floor is a client-RUNTIME policy (node 24 strips TS types
  // natively, so generated clients import without a loader). It is not a
  // build-feasibility constraint: bundler plugins compile inside the HOST's
  // build (often node 22), where the generated TypeScript is transpiled by
  // the bundler. Pass skipRuntimeGate from those paths.
  if (!opts.skipRuntimeGate && runtime === 'node') {
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
  // zig on PATH, else the provision cache (no download here — doctor stays a
  // fast report; the build provisions on demand).
  const zigPath = (await which('zig')) ?? (await findCachedZig());
  const clangPath = (await which('clang')) ?? undefined;
  const ccPath = (await which('cc')) ?? undefined;
  const denoPath = (await which('deno')) ?? undefined;

  // Doctor doubles as the link repairer: if a previous build generated
  // clients, make sure `@scriptcable/client` resolves (no-op when current).
  let clientLink: ToolchainInfo['clientLink'];
  const genDir = join(cwd, '.scriptcable', 'generated');
  try {
    await access(genDir);
    clientLink = await ensureClientPackageLink(cwd, genDir);
  } catch {
    /* nothing generated yet */
  }

  return {
    scriptcBin,
    version,
    runtime,
    nodeVersion,
    bunVersion,
    hasZig: Boolean(zigPath),
    hasClang: Boolean(clangPath),
    hasCc: Boolean(ccPath),
    hasDeno: Boolean(denoPath),
    zigPath,
    clangPath,
    ccPath,
    denoPath,
    clientLink,
  };
}

export type BuildOptions = {
  cwd?: string;
  /** wasm | native | both */
  target?: 'wasm' | 'native' | 'both';
  /** Host platform for native builds — android-arm64 cross-compiles
   * (SCRIPTC_TARGET + zig cc) and puts artifacts under outDir/android-arm64/ */
  platform?: 'host' | 'android-arm64';
  outDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Bypass the build cache (default: false — cached hits skip scriptc + link) */
  force?: boolean;
  /**
   * Bundler plugins run inside the host's build process (any node version) —
   * the generated TypeScript is transpiled by the bundler, so the node >= 24
   * client-runtime policy must not fail the host build. Pass 'skip' there.
   */
  doctorRuntimeGate?: 'strict' | 'skip';
};

export type BuildResult = {
  profilePath: string;
  wasmPath?: string;
  /** Static archive from scriptc (.lib.a) */
  nativePath?: string;
  /** Loadable shared library linked from the archive (.so/.dylib/.dll) */
  sharedPath?: string;
  /** Typed N-API direct-binding addon (.node) — preferred by generated clients, soft-failed */
  addonPath?: string;
  profile: ScriptcableProfile;
  /** True when this result came from the build cache (no recompile) */
  cached?: boolean;
};

async function ensureRuntimePack(cwd: string, target: 'wasm' | 'android-arm64'): Promise<void> {
  const pack =
    target === 'wasm' ? '@scriptc/runtime-wasm32-wasi' : '@scriptc/runtime-android-arm64';
  const require = createRequire(join(cwd, 'package.json'));
  try {
    require.resolve(`${pack}/package.json`);
    return;
  } catch {
    const info = await doctor(cwd);
    const ver = info.version.replace(/^v/, '');
    const r = await run('bun', ['add', '--dev', `${pack}@${ver}`], { cwd });
    if (r.code !== 0) {
      throw new ScriptcableToolchainError(
        `Failed to install ${pack} (required for ${target} builds).`,
        r.stderr.slice(0, 500) +
          (target === 'wasm'
            ? '\nAlso install zig 0.13.x on PATH: https://ziglang.org/download/'
            : ''),
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
  config: ResolvedConfig,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const outDir = resolve(cwd, options.outDir ?? config.outDir ?? '.scriptcable');
  const target = options.target ?? config.target ?? 'native';
  const androidArm64 = options.platform === 'android-arm64';
  // Android artifacts live under outDir/android-arm64/ so a host .so and the
  // android one never overwrite each other.
  const nativeDir = androidArm64 ? join(outDir, 'android-arm64') : outDir;
  await mkdir(outDir, { recursive: true });

  const info = await doctor(cwd, { skipRuntimeGate: options.doctorRuntimeGate === 'skip' });
  // wasm/cross builds drive zig off PATH — resolve it once per build (the
  // provision cache auto-populates unless SCRIPTCABLE_NO_AUTO_TOOLS=1), and
  // ride the resolved binary's directory on the scriptc subprocess PATH.
  const needsZig = target === 'wasm' || target === 'both' || androidArm64;
  const buildZig = needsZig ? await ensureZig((m) => console.log(`  ${m}`)) : undefined;
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
  const addonEligible = target !== 'wasm' && !androidArm64 && canBuildNodeAddon(profile);
  // A previous soft-failed addon attempt is recorded in a marker — keep the
  // cache valid without demanding the artifact until a build succeeds again
  // (any successful build clears the marker; --force bypasses everything).
  const addonFailedBefore =
    addonEligible &&
    (await readFile(join(outDir, 'addon-failed'), 'utf8').then(
      () => true,
      () => false,
    ));
  const wantedArtifacts =
    target === 'wasm'
      ? [join(outDir, `${config.name}.wasm`)]
      : target === 'both'
        ? [join(outDir, `${config.name}.wasm`), join(nativeDir, sharedLibraryFileName(config.name))]
        : [join(nativeDir, sharedLibraryFileName(config.name))];
  const addonDemanded = addonEligible && !addonFailedBefore;
  if (addonDemanded) wantedArtifacts.push(join(outDir, napiAddonFileName(config.name)));
  const cacheHit =
    options.force !== true &&
    (await isCachedBuild({ outDir, target, hash: buildHash, artifactPaths: wantedArtifacts }));

  if (cacheHit) {
    if (target === 'wasm' || target === 'both') {
      result.wasmPath = join(outDir, `${config.name}.wasm`);
    }
    if (target === 'native' || target === 'both') {
      result.nativePath = join(nativeDir, `${config.name}.lib.a`);
      result.sharedPath = join(nativeDir, sharedLibraryFileName(config.name));
      if (addonDemanded) result.addonPath = join(outDir, napiAddonFileName(config.name));
    }
    result.cached = true;
    return result;
  }

  const runBuild = async (kind: 'wasm' | 'native') => {
    if (kind === 'wasm') {
      if (!buildZig) {
        throw new ScriptcableToolchainError(
          'zig is required for WASM (wasm32-wasi) library builds.',
          'scriptcable provisions zig 0.13.x automatically — that was skipped (download failed, or SCRIPTCABLE_NO_AUTO_TOOLS=1).\n' +
            'Retry without the env, or install zig 0.13.x and put it on PATH.\n' +
            '  curl -fsSL https://ziglang.org/download/0.13.0/zig-linux-x86_64-0.13.0.tar.xz | tar -xJ\n' +
            'Note: zig 0.14 currently fails WASI builds with scriptc 0.3.x — use 0.13.',
        );
      }
      await ensureRuntimePack(cwd, 'wasm');
    } else if (androidArm64) {
      if (!buildZig) {
        throw new ScriptcableToolchainError(
          'zig is required for android-arm64 cross builds (SCRIPTC_TARGET + zig cc link).',
          'scriptcable provisions zig 0.13.x automatically — that was skipped (download failed, or SCRIPTCABLE_NO_AUTO_TOOLS=1).\n' +
            'Retry without the env, or install zig 0.13.x and put it on PATH.',
        );
      }
      await ensureRuntimePack(cwd, 'android-arm64');
    } else if (!info.hasClang && !info.hasCc && !info.hasZig && !buildZig && process.platform === 'linux') {
      throw new ScriptcableToolchainError(
        'clang (or cc) — or zig — is required for native library builds on Linux.',
        'Install clang (`sudo apt install clang`; gcc\'s cc also works), or run a wasm build once so the\n' +
          'provisioned zig cc can link the shared library — or use target: "wasm".',
      );
    }

    const outName = kind === 'wasm' ? `${config.name}.wasm` : `${config.name}.lib.a`;
    const outPath = join(kind === 'native' ? nativeDir : outDir, outName);
    const args = ['build', '--lib', '--profile', profilePath, '-o', outPath];
    const inv = scriptcInvoke(info.scriptcBin, args);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...options.env,
      ...(buildZig
        ? { PATH: `${dirname(buildZig)}${delimiter}${options.env?.PATH ?? process.env.PATH ?? ''}` }
        : {}),
      ...(kind === 'wasm' ? { SCRIPTC_TARGET: 'wasm32-wasi' } : {}),
      ...(kind === 'native' && androidArm64 ? { SCRIPTC_TARGET: 'aarch64-linux-android' } : {}),
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
    if (androidArm64) {
      // Materialize the JNI dispatch sources so the bridge .so ships
      // COMPLETE (JNI + dispatch + statically-linked archive in one DSO).
      // The RN codegen writes the same files afterwards — skip-identical.
      const androidGen = join(outDir, 'generated', 'android');
      const { files: rnFiles } = generateClients(config, ['react-native'], {
        wasmFileName: `${config.name}.wasm`,
      });
      await mkdir(androidGen, { recursive: true });
      for (const [name, body] of Object.entries(rnFiles)) {
        if (!name.startsWith('android/')) continue;
        const p = join(outDir, 'generated', name);
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, body);
      }
    }
    // Host batch executive — a plain C entry linked into the shared library
    // so bun:ffi/koffi hosts (Node/Windows without the addon) run N calls
    // across one boundary too. Android's version script exports only Java_*
    // (which would localize the executive symbol into uselessness) and its
    // selective-pulling link is sensitive to extra objects — excluded.
    const extraSources: string[] = [];
    if (androidArm64) {
      extraSources.push(
        join(outDir, 'generated', 'android', 'cable_host.cpp'),
        join(outDir, 'generated', 'android', 'cable_jni.cpp'),
      );
    } else {
      const batchSource = generateSharedBatchSource(profile);
      if (batchSource) {
        const batchC = join(outDir, `${config.name}-batch.c`);
        await writeFile(batchC, batchSource);
        extraSources.push(batchC);
      } else {
        console.log(`  batch-so:   skipped — exports empty or an export collides with ${SHARED_BATCH_SYMBOL}`);
      }
    }
    result.sharedPath = await linkSharedLibrary({
      archivePath: result.nativePath!,
      outPath: join(nativeDir, sharedLibraryFileName(config.name)),
      target: androidArm64 ? 'aarch64-linux-android' : undefined,
      cwd,
      zigPath: buildZig ?? info.zigPath,
      preferZigLink: !info.hasClang && !info.hasCc,
      extraSources: extraSources.length ? extraSources : undefined,
      includeDirs: androidArm64 ? [join(outDir, 'generated', 'android')] : undefined,
    });
    // Typed N-API direct binding — soft failure: generic FFI remains the fallback.
    if (addonEligible) {
      try {
        result.addonPath = await buildNodeAddon({
          archivePath: result.nativePath!,
          outDir,
          name: config.name,
          profile,
        });
        await rm(join(outDir, 'addon-failed'), { force: true });
      } catch (e) {
        const reason = e instanceof Error ? e.message.split('\n')[0] : String(e);
        console.warn(`  addon:     skipped — ${reason}`);
        await writeFile(join(outDir, 'addon-failed'), reason + '\n');
      }
    } else if (profile.callbacks?.length) {
      console.log(
        `  addon:     skipped — callbacks are not supported by the typed addon yet (generic FFI path)`,
      );
    }
    // Self-contained static archive for hosts that link natively (Tauri/RN/Lynx)
    await buildCompleteStaticArchive({
      archivePath: result.nativePath!,
      outPath: join(outDir, `lib${config.name}.a`),
      zigPath: buildZig ?? info.zigPath,
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

/**
 * Make sure the WASM artifact for the browser flavor exists. Native-default
 * builds (the Next / Webpack plugins) don't produce one, but the generated
 * browser client needs `<name>.wasm`. Reuses a previously built wasm — the
 * build cache makes the first build the only expensive one — and soft-fails
 * (undefined + a printed reason) when zig is missing or the wasm build
 * errors, so native-only hosts keep working unchanged.
 */
export async function ensureWasmArtifact(
  config: ResolvedConfig,
  options: { cwd?: string; outDir?: string } = {},
): Promise<string | undefined> {
  const cwd = options.cwd ?? process.cwd();
  const outDir = resolve(cwd, options.outDir ?? config.outDir ?? '.scriptcable');
  const existing = join(outDir, `${config.name}.wasm`);
  try {
    await access(existing);
    return existing;
  } catch {
    /* build below */
  }
  try {
    const result = await buildCore(config, { cwd, outDir, target: 'wasm' });
    return result.wasmPath;
  } catch (e) {
    const reason = e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.warn(`  wasm:      browser flavor unavailable — ${reason}`);
    console.warn('             run `scriptcable build --target wasm` to enable it (needs zig 0.13)');
    return undefined;
  }
}
