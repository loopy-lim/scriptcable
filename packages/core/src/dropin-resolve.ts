/**
 * enhanced-resolve plugin shared by the webpack-family hosts (webpack,
 * Rspack/Rspeedy, Next.js webpack): redirects module requests that would
 * resolve to the core entry onto the generated drop-in client. App code
 * keeps importing the TS entry; the bundle gets the compiled client.
 *
 * Tap point: the resolver's `resolve` hook — after the importer directory is
 * known (`request.path`) but before file resolution, so a relative specifier
 * like `./core` can be compared against the entry's path without running a
 * second resolution. Bare specifiers are left to the default resolution.
 */
import { extname, resolve as resolvePath } from 'node:path';

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Windows-portable path comparison: backslashes → forward slashes, and
 * case-folded on win32 (case-insensitive filesystems). found by the
 * allow-fail Windows CI job — every comparison below goes through this.
 */
function normPath(p: string): string {
  const f = p.replace(/\\/g, '/');
  return process.platform === 'win32' ? f.toLowerCase() : f;
}

export type DropinResolveRequest = {
  path?: string;
  request?: string;
  [key: string]: unknown;
};

export class ScriptcableDropinResolvePlugin {
  readonly name = 'ScriptcableDropinResolvePlugin';

  constructor(
    private readonly entryAbs: string,
    private readonly dropinPath: string,
  ) {}

  /** Entry path without its source extension — matches extensionless imports too. */
  private entryBase(): string {
    const ext = extname(this.entryAbs);
    const base = SOURCE_EXTS.has(ext) ? this.entryAbs.slice(0, -ext.length) : this.entryAbs;
    return normPath(base);
  }

  private matches(absolute: string): boolean {
    const ext = extname(absolute);
    const base = SOURCE_EXTS.has(ext) ? absolute.slice(0, -ext.length) : absolute;
    return normPath(base) === this.entryBase();
  }

  apply(resolver: {
    getHook: (name: string) => {
      tapAsync: (
        name: string,
        fn: (request: DropinResolveRequest, ctx: unknown, cb: (err?: unknown, result?: unknown) => void) => void,
      ) => void;
    };
    ensureHook: (name: string) => unknown;
    doResolve: (hook: unknown, request: DropinResolveRequest, message: string | null, ctx: unknown, cb: (err?: unknown, result?: unknown) => void) => void;
  }): void {
    const target = resolver.ensureHook('resolve');
    resolver.getHook('resolve').tapAsync(this.name, (request, resolveContext, cb) => {
      try {
        const req = request?.request;
        if (!req || req.startsWith('\0')) return cb();
        // Only relative and absolute requests can reach a project file
        // (windows absolute: `C:\…`, `C:/…`, `\\server\…`).
        if (!req.startsWith('.') && !/^[A-Za-z]:[\\/]/.test(req) && !req.startsWith('/') && !req.startsWith('\\\\')) {
          return cb();
        }
        const base = resolvePath(request.path ?? process.cwd(), req);
        if (!this.matches(base)) return cb();
        const redirected: DropinResolveRequest = { ...request, request: this.dropinPath };
        return resolver.doResolve(target, redirected, 'scriptcable drop-in', resolveContext, cb);
      } catch {
        // Never break resolution over the redirect — fall through to default.
        return cb();
      }
    });
  }
}

export function createDropinResolvePlugin(entryAbs: string, dropinPath: string): ScriptcableDropinResolvePlugin {
  return new ScriptcableDropinResolvePlugin(entryAbs, dropinPath);
}
