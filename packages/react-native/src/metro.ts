/**
 * Metro (React Native) drop-in resolver — the RN counterpart of the bundler
 * plugins. Metro ignores package export conditions, so RN gets its own
 * generated drop-in (`dropin/react-native.ts`) and this resolver redirects
 * imports of the core entry onto it. App code keeps importing `./core`.
 *
 * Usage in `metro.config.js` (runs in Node, hence the dedicated subpath):
 *
 *   const { withScriptcableMetro } = require('@scriptcable/react-native/metro');
 *   module.exports = withScriptcableMetro(getDefaultConfig(__dirname));
 *
 * The redirect fires only after `scriptcable build --hosts react-native`
 * has produced the drop-in; before that, imports resolve as usual. Run the
 * build (or `scriptcable build --watch`) alongside the Metro dev server.
 */
import { existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, resolve as resolvePath } from 'node:path';

export type ScriptcableMetroOptions = {
  cwd?: string;
  /** Path to the core entry (absolute or cwd-relative) — default: standard locations */
  entry?: string;
};

const STANDARD_ENTRIES = ['src/core.ts', 'core.ts', 'src/index.ts', 'index.ts'];
const GENERATED_DROPIN = '.scriptcable/generated/dropin/react-native.ts';
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export type MetroResolution = { type: 'sourceFile'; filePath: string };
export type MetroResolveContext = {
  /**
   * Absolute path of the importing file. The field name moved between Metro
   * versions: `originModulePath` in metro 0.87 / RN 0.88 (verified), older
   * docs said `originPath` — read both.
   */
  originModulePath?: string;
  originPath?: string;
  resolveRequest: (
    context: MetroResolveContext,
    moduleName: string,
    platform: string | null,
  ) => MetroResolution | null;
};
export type MetroResolveRequest = (
  context: MetroResolveContext,
  moduleName: string,
  platform: string | null,
) => MetroResolution | null;

function baseOf(p: string): string {
  const ext = extname(p);
  return SOURCE_EXTS.has(ext) ? p.slice(0, -ext.length) : p;
}

/** The core entry path, or null when no standard entry exists. */
export function resolveScriptcableEntry(opts: ScriptcableMetroOptions = {}): string | null {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.entry) return resolvePath(cwd, opts.entry);
  for (const e of STANDARD_ENTRIES) {
    const p = resolvePath(cwd, e);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Does this request resolve to the core entry (and a drop-in exists)? */
function matchesEntryRequest(
  context: MetroResolveContext,
  moduleName: string,
  cwd: string,
  entryAbs: string,
  dropinPath: string,
): boolean {
  try {
    if (!existsSync(dropinPath)) return false;
    if (!moduleName.startsWith('.') && !isAbsolute(moduleName)) return false;
    const origin = context.originModulePath ?? context.originPath;
    const from = origin ? dirname(origin) : cwd;
    return baseOf(resolvePath(from, moduleName)) === baseOf(entryAbs);
  } catch {
    return false;
  }
}

/**
 * The generated clients import each other with explicit `.js` specifiers
 * (Node convention — plain Node type-stripping needs them). Metro does no
 * `.js` → `.ts` aliasing, so map it — scoped to requests inside (or into)
 * the generated tree, where those specifiers come from us.
 */
function resolveGeneratedJsSpecifier(
  context: MetroResolveContext,
  moduleName: string,
  cwd: string,
): MetroResolution | null {
  try {
    if (!moduleName.startsWith('.')) return null;
    const origin = context.originModulePath ?? context.originPath;
    const from = origin ? dirname(origin) : cwd;
    const target = resolvePath(from, moduleName);
    const generatedRoot = resolvePath(cwd, '.scriptcable', 'generated');
    if (!target.startsWith(generatedRoot) && !(origin && origin.startsWith(generatedRoot))) return null;
    if (extname(target) !== '.js') return null;
    const tsSibling = target.slice(0, -3) + '.ts';
    if (existsSync(tsSibling)) return { type: 'sourceFile', filePath: tsSibling };
    return null;
  } catch {
    return null;
  }
}

/**
 * A Metro `resolver.resolveRequest` that redirects imports resolving to the
 * core entry onto the generated RN drop-in; everything else falls through to
 * the default resolution. Returns null when the project has no entry
 * (nothing to intercept).
 */
export function createScriptcableResolveRequest(opts: ScriptcableMetroOptions = {}): MetroResolveRequest | null {
  const cwd = opts.cwd ?? process.cwd();
  const entryAbs = resolveScriptcableEntry(opts);
  if (!entryAbs) return null;
  const dropinPath = resolvePath(cwd, GENERATED_DROPIN);

  return (context, moduleName, platform) => {
    if (matchesEntryRequest(context, moduleName, cwd, entryAbs, dropinPath)) {
      return { type: 'sourceFile', filePath: dropinPath };
    }
    const generatedJs = resolveGeneratedJsSpecifier(context, moduleName, cwd);
    if (generatedJs) return generatedJs;
    return context.resolveRequest(context, moduleName, platform);
  };
}

/**
 * Wrap a Metro config so entry imports resolve to the compiled client.
 *
 * The entry redirect WINS over any existing `resolver.resolveRequest`:
 * Metro's own default config ships one, and it resolves the entry import
 * happily — verified against metro 0.87 / RN 0.88, an "existing resolver
 * first" chain would silently disable the drop-in (the unit-suite stub that
 * declines everything hid exactly this). Every other request delegates to
 * the previous resolver, then to Metro's default resolution.
 */
export function withScriptcableMetro<
  T extends { resolver?: { resolveRequest?: MetroResolveRequest } },
>(config: T, opts: ScriptcableMetroOptions = {}): T {
  const cwd = opts.cwd ?? process.cwd();
  const entryAbs = resolveScriptcableEntry(opts);
  if (!entryAbs) return config;
  const dropinPath = resolvePath(cwd, GENERATED_DROPIN);
  const prev = config.resolver?.resolveRequest;
  const chained: MetroResolveRequest = (context, moduleName, platform) => {
    if (matchesEntryRequest(context, moduleName, cwd, entryAbs, dropinPath)) {
      return { type: 'sourceFile', filePath: dropinPath };
    }
    const generatedJs = resolveGeneratedJsSpecifier(context, moduleName, cwd);
    if (generatedJs) return generatedJs;
    if (prev) return prev(context, moduleName, platform);
    return context.resolveRequest(context, moduleName, platform);
  };
  return { ...config, resolver: { ...config.resolver, resolveRequest: chained } };
}
