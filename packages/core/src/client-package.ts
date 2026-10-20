/**
 * The generated client as a real package: the build writes a package.json
 * into the generated dir and links it as `node_modules/@scriptcable/client`,
 * so every resolver — bundler graphs (Next webpack/Turbopack, Webpack/Rspack,
 * Vite), the Bun runtime, and the editor's TS server — resolves the same bare
 * specifier without any app-side alias or relative path. Export conditions
 * pick the flavor per environment: bun/node runtimes get the native flavor,
 * browser graphs the WASM one.
 */
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, basename, relative, resolve } from 'node:path';
import type { ResolvedConfig, ScriptcableProfile } from '@scriptcable/types';
import { generateClients, type CodegenTarget } from './codegen.js';

const PACKAGE_NAME = '@scriptcable/client';

/** Export condition and file for each generated flavor. */
const CONDITION_BY_TARGET: Record<CodegenTarget, { condition: string; file: string }> = {
  bun: { condition: 'bun', file: 'bun.ts' },
  node: { condition: 'node', file: 'node.ts' },
  browser: { condition: 'browser', file: 'browser.ts' },
  lynx: { condition: 'lynx', file: 'lynx.ts' },
  'react-native': { condition: 'react-native', file: 'react-native.ts' },
  tauri: { condition: 'tauri', file: 'tauri.ts' },
};

/**
 * `.` entry in first-match order: runtime flavors first (bun wins under Bun,
 * node under Node), then browser for web graphs. Environments with no
 * matching condition (editor TS) fall through to `default`.
 */
const DOT_CONDITION_ORDER: CodegenTarget[] = ['bun', 'node', 'browser', 'react-native', 'lynx', 'tauri'];

/** Flavor used for `default` when no condition matches — browser first. */
const DEFAULT_FALLBACK_ORDER: CodegenTarget[] = ['browser', 'node', 'bun', 'react-native', 'lynx', 'tauri'];

/** package.json for the generated client package — conditions only for flavors that were generated. */
export function clientPackageManifest(targets: CodegenTarget[]): Record<string, unknown> {
  const dot: Record<string, string> = {};
  for (const t of DOT_CONDITION_ORDER) {
    if (targets.includes(t)) dot[CONDITION_BY_TARGET[t].condition] = `./${CONDITION_BY_TARGET[t].file}`;
  }
  const fallback = DEFAULT_FALLBACK_ORDER.find((t) => targets.includes(t));
  if (fallback) dot.default = `./${CONDITION_BY_TARGET[fallback].file}`;

  const exports: Record<string, unknown> = { '.': dot };
  for (const t of targets) {
    exports[`./${CONDITION_BY_TARGET[t].condition}`] = `./${CONDITION_BY_TARGET[t].file}`;
  }
  exports['./*'] = './*.ts';

  return {
    name: PACKAGE_NAME,
    version: '0.0.0-scriptcable',
    private: true,
    type: 'module',
    exports,
  };
}

/** Write generated/package.json; returns true when the file changed. */
export async function writeClientPackage(genDir: string, targets: CodegenTarget[]): Promise<boolean> {
  const body = JSON.stringify(clientPackageManifest(targets), null, 2) + '\n';
  const path = join(genDir, 'package.json');
  try {
    if ((await readFile(path, 'utf8')) === body) return false;
  } catch {
    /* not written yet */
  }
  await writeFile(path, body);
  return true;
}

export type ClientLinkResult =
  | 'current' // symlink already points at genDir
  | 'linked' // created
  | 'repaired' // stale/dangling symlink replaced
  | 'blocked'; // a real file/dir occupies the path, or symlink unsupported

/**
 * Ensure `<cwd>/node_modules/@scriptcable/client` resolves to `genDir`.
 * Best-effort: never throws, never touches a real (non-symlink) entry.
 * Uses a relative target so the link survives directory moves and CI checkouts.
 */
export async function ensureClientPackageLink(cwd: string, genDir: string): Promise<ClientLinkResult> {
  try {
    await access(genDir);
  } catch {
    return 'blocked'; // nothing generated yet
  }
  const linkDir = join(cwd, 'node_modules', '@scriptcable');
  const linkPath = join(linkDir, 'client');
  const relTarget = relative(linkDir, genDir);

  let replaced = false;
  try {
    const st = await lstat(linkPath);
    if (!st.isSymbolicLink()) return 'blocked'; // user's own package — leave it alone
    const resolved = resolve(dirname(linkPath), await readlink(linkPath));
    if (resolved === resolve(genDir)) return 'current';
    await unlink(linkPath);
    replaced = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return 'blocked';
  }

  try {
    await mkdir(linkDir, { recursive: true });
    await symlink(relTarget, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    return replaced ? 'repaired' : 'linked';
  } catch (e) {
    // Concurrent emits can race to create the link — classify by what won.
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      try {
        const st = await lstat(linkPath);
        if (st.isSymbolicLink() && resolve(dirname(linkPath), await readlink(linkPath)) === resolve(genDir)) {
          return 'current';
        }
      } catch {
        /* fall through */
      }
    }
    return 'blocked';
  }
}

async function copyIfChanged(src: string, dest: string): Promise<void> {
  try {
    const [a, b] = await Promise.all([readFile(src), readFile(dest)]);
    if (a.equals(b)) return;
  } catch {
    /* copy below */
  }
  await copyFile(src, dest);
}

/**
 * Single emit point shared by the CLI and the bundler plugins: generate the
 * client flavors, write them (skipping identical content so watchers don't
 * churn), copy build artifacts next to them, and publish the
 * `@scriptcable/client` package (manifest + node_modules link). Returns genDir.
 */
export async function writeGeneratedClients(opts: {
  config: ResolvedConfig;
  targets: CodegenTarget[];
  /** Absolute outDir (e.g. `<project>/.scriptcable`). */
  outDir: string;
  /** Project root — where `node_modules/@scriptcable/client` is linked. */
  cwd: string;
  profile?: ScriptcableProfile;
  wasmFileName?: string;
  /** Build artifacts to copy next to the clients (from buildCore). */
  copy?: { wasmPath?: string; sharedPath?: string };
}): Promise<{ genDir: string; clientLink: ClientLinkResult }> {
  const genDir = join(opts.outDir, 'generated');
  const wasmName = opts.wasmFileName ?? `${opts.config.name}.wasm`;
  const generated = generateClients(opts.config, opts.targets, {
    wasmFileName: wasmName,
    profile: opts.profile,
  });
  await mkdir(genDir, { recursive: true });
  for (const [name, body] of Object.entries(generated.files)) {
    const path = join(genDir, name);
    try {
      if ((await readFile(path, 'utf8')) === body) continue;
    } catch {
      /* not written yet */
    }
    await writeFile(path, body);
  }
  if (opts.copy?.sharedPath) {
    await copyIfChanged(opts.copy.sharedPath, join(genDir, basename(opts.copy.sharedPath)));
  }
  if (opts.copy?.wasmPath) {
    await copyIfChanged(opts.copy.wasmPath, join(genDir, wasmName));
  }
  await writeClientPackage(genDir, opts.targets);
  const clientLink = await ensureClientPackageLink(opts.cwd, genDir);
  return { genDir, clientLink };
}
