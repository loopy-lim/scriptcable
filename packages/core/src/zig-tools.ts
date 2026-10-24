/**
 * zig 0.13.x provisioning — wasm32-wasi and android-arm64 builds need zig,
 * and scriptc drives it off PATH. Resolution order: PATH → a machine-level
 * cache under the user's cache dir → a one-time download (opt-out with
 * SCRIPTCABLE_NO_AUTO_TOOLS=1). A cached zig is put on the build
 * subprocess's PATH, so nothing downstream has to know about the cache.
 */
import { access, constants, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { which } from './which.js';

/** scriptc 0.3.x WASI builds fail under zig 0.14 — this series is pinned. */
export const ZIG_VERSION = '0.13.0';

/** Machine-level tool cache — override with SCRIPTCABLE_CACHE_DIR. */
export function zigCacheRoot(): string {
  const override = process.env.SCRIPTCABLE_CACHE_DIR;
  if (override) return override;
  if (process.platform === 'win32') {
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'scriptcable',
      'cache',
    );
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'scriptcable');
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'scriptcable');
}

export function zigInstallDir(): string {
  return join(zigCacheRoot(), `zig-${ZIG_VERSION}`);
}

function zigBinName(platform = process.platform): string {
  return platform === 'win32' ? 'zig.exe' : 'zig';
}

/** zig names targets after GNU tuples: x64 → x86_64, arm64 → aarch64. */
function zigArch(arch = process.arch): string {
  if (arch === 'x64') return 'x86_64';
  if (arch === 'arm64') return 'aarch64';
  return arch;
}

function zigOs(platform = process.platform): string {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return platform;
}

export function zigDownloadUrl(platform = process.platform, arch = process.arch): string {
  const ext = platform === 'win32' ? 'zip' : 'tar.xz';
  return `https://ziglang.org/download/${ZIG_VERSION}/zig-${zigOs(platform)}-${zigArch(arch)}-${ZIG_VERSION}.${ext}`;
}

async function run(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

async function cachedZigVersion(bin: string): Promise<string | undefined> {
  try {
    const r = await run(bin, ['version']);
    return r.code === 0 ? r.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

let cachedZigPath: Promise<string | undefined> | undefined;

/** zig from the provision cache only (no download, no PATH) — memoized per process. */
export function findCachedZig(): Promise<string | undefined> {
  cachedZigPath ??= (async () => {
    const bin = join(zigInstallDir(), zigBinName());
    try {
      await access(bin, constants.X_OK);
    } catch {
      return undefined;
    }
    const v = await cachedZigVersion(bin);
    return v?.startsWith('0.13') ? bin : undefined;
  })();
  return cachedZigPath;
}

/** zig from PATH, else the provision cache. Never downloads. */
export async function findZig(): Promise<string | undefined> {
  return (await which('zig')) ?? (await findCachedZig());
}

/**
 * findZig, then — unless SCRIPTCABLE_NO_AUTO_TOOLS=1 — a one-time download of
 * the pinned zig into the cache. Returns the zig binary path or undefined
 * (callers keep their manual-install hints). Idempotent: cached installs and
 * concurrent downloads of the same version are single-flight per process.
 */
let ensureInFlight: Promise<string | undefined> | undefined;
export function ensureZig(log: (msg: string) => void = () => {}): Promise<string | undefined> {
  ensureInFlight ??= (async () => {
    try {
      const found = await findZig();
      if (found) return found;
      if (process.env.SCRIPTCABLE_NO_AUTO_TOOLS === '1') return undefined;

      const url = zigDownloadUrl();
      const installDir = zigInstallDir();
      if (process.arch !== 'x64' && process.arch !== 'arm64') {
        log(`no prebuilt zig 0.13.x for ${process.arch} — install zig and put it on PATH`);
        return undefined;
      }
      log(
        `zig not found — downloading ${basename(url)} to ${installDir} (one-time; SCRIPTCABLE_NO_AUTO_TOOLS=1 disables)`,
      );
      let res: Response;
      try {
        // A stalled connection must not hang the build forever.
        res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        log(
          `zig download failed (${e instanceof Error ? e.message : String(e)}) — install zig 0.13.x and put it on PATH`,
        );
        return undefined;
      }
      if (!res.ok || !res.body) {
        log(`zig download failed (HTTP ${res.status}) — install zig 0.13.x and put it on PATH`);
        return undefined;
      }
      const workDir = join(zigCacheRoot(), `.zig-download-${process.pid}`);
      await rm(workDir, { recursive: true, force: true });
      await mkdir(workDir, { recursive: true });
      try {
        const archive = join(workDir, basename(url));
        await writeFile(archive, Buffer.from(await res.arrayBuffer()));
        // GNU tar auto-detects .xz on extract; Windows ships bsdtar, which
        // reads the zip directly. A missing/failing tar degrades to the
        // manual-install hint — never a raw spawn error through buildCore.
        const extractArgs =
          process.platform === 'win32' ? ['-xf', archive] : ['-xJf', archive];
        let tar;
        try {
          tar = await run('tar', [...extractArgs, '-C', workDir]);
        } catch (e) {
          log(
            `zig extraction failed (tar unavailable: ${e instanceof Error ? e.message : String(e)}) — install zig 0.13.x and put it on PATH`,
          );
          return undefined;
        }
        if (tar.code !== 0) {
          log(`zig extraction failed — install zig 0.13.x and put it on PATH\n${tar.stderr}`);
          return undefined;
        }
        const extractedRoot = join(workDir, basename(url).replace(/\.tar\.xz$|\.zip$/, ''));
        await rm(installDir, { recursive: true, force: true });
        await rename(extractedRoot, installDir);
      } catch (e) {
        log(
          `zig install failed (${e instanceof Error ? e.message : String(e)}) — install zig 0.13.x and put it on PATH`,
        );
        return undefined;
      } finally {
        // A crashed or failed attempt leaves no litter in the cache root.
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
      const bin = join(installDir, zigBinName());
      const v = await cachedZigVersion(bin);
      if (!v?.startsWith('0.13')) {
        log(`downloaded zig reported "${v ?? 'nothing'}" — expected 0.13.x; ignoring it`);
        await rm(installDir, { recursive: true, force: true });
        return undefined;
      }
      log(`zig ${v} ready at ${bin}`);
      // A long-lived process may have memoized the earlier negative lookup.
      cachedZigPath = Promise.resolve(bin);
      return bin;
    } finally {
      ensureInFlight = undefined;
    }
  })();
  return ensureInFlight;
}
