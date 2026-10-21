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
  /** Absolute path of the importing file (Metro ≥ 0.72). */
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

/**
 * A Metro `resolver.resolveRequest` that redirects imports resolving to the
 * core entry onto the generated RN drop-in. Returns null when the project
 * has no entry (nothing to intercept — use the default resolution).
 */
export function createScriptcableResolveRequest(opts: ScriptcableMetroOptions = {}): MetroResolveRequest | null {
  const cwd = opts.cwd ?? process.cwd();
  const entryAbs = resolveScriptcableEntry(opts);
  if (!entryAbs) return null;
  const entryBase = baseOf(entryAbs);
  const dropinPath = resolvePath(cwd, GENERATED_DROPIN);

  return (context, moduleName, platform) => {
    try {
      if (
        existsSync(dropinPath) &&
        (moduleName.startsWith('.') || isAbsolute(moduleName)) &&
        baseOf(resolvePath(context.originPath ? dirname(context.originPath) : cwd, moduleName)) === entryBase
      ) {
        return { type: 'sourceFile', filePath: dropinPath };
      }
    } catch {
      /* fall through to the default resolution */
    }
    return context.resolveRequest(context, moduleName, platform);
  };
}

/**
 * Wrap a Metro config so entry imports resolve to the compiled client. An
 * existing `resolver.resolveRequest` keeps priority: it runs first, and the
 * drop-in redirect applies when it declines.
 */
export function withScriptcableMetro<
  T extends { resolver?: { resolveRequest?: MetroResolveRequest } },
>(config: T, opts: ScriptcableMetroOptions = {}): T {
  const resolveRequest = createScriptcableResolveRequest(opts);
  if (!resolveRequest) return config;
  const prev = config.resolver?.resolveRequest;
  const chained: MetroResolveRequest = prev
    ? (context, moduleName, platform) => {
        const theirs = prev(context, moduleName, platform);
        return theirs ?? resolveRequest(context, moduleName, platform);
      }
    : resolveRequest;
  return { ...config, resolver: { ...config.resolver, resolveRequest: chained } };
}
