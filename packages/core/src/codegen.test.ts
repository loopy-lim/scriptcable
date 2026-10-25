/**
 * Codegen tests: the generated browser client's WASM URL resolution —
 * module-relative and origin-root candidates with a HEAD probe, explicit
 * `wasmUrl` winning, and the first candidate as the error-surfacing fallback.
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { generateClients } from './codegen.js';
import type { ResolvedConfig, ScriptcableProfile } from '@scriptcable/types';

const CONFIG: ResolvedConfig = {
  name: 'calc',
  entry: 'src/core.ts',
  prefix: 'calc_',
  exports: [{ name: 'add', params: ['f64', 'f64'], returns: 'f64' }],
} as ResolvedConfig;

function browserClient(): string {
  const { files } = generateClients(CONFIG, ['browser']);
  return files['browser.ts']!;
}

describe('generated browser client', () => {
  it('probes a module-relative and an origin-root URL candidate', () => {
    const src = browserClient();
    assert.match(src, /new URL\(WASM_FILE, import\.meta\.url\)/, 'missing module-relative candidate');
    assert.match(src, /document\.baseURI/, 'missing origin-root candidate (Next public/)');
    assert.match(src, /CANDIDATES\[0\]/, 'missing fallback to the first candidate');
  });

  it('resolves with a HEAD probe and caches the winner', () => {
    const src = browserClient();
    assert.match(src, /method: 'HEAD'/);
    assert.match(src, /let resolvedUrl/, 'missing module-scope resolution cache');
  });

  it('an explicit wasmUrl always wins over probing', () => {
    const src = browserClient();
    const fnStart = src.indexOf('async function resolveWasmUrl');
    const explicitIdx = src.indexOf('if (explicit)', fnStart);
    const loopIdx = src.indexOf('for (const url of CANDIDATES)', fnStart);
    assert.ok(fnStart >= 0, 'resolveWasmUrl missing');
    assert.ok(explicitIdx >= 0, 'explicit wasmUrl branch missing');
    assert.ok(loopIdx > explicitIdx, 'probing must not run before the explicit branch');
  });

  it('the root candidate guards non-DOM environments', () => {
    const src = browserClient();
    assert.match(src, /typeof document !== 'undefined'/);
    assert.match(src, /typeof location !== 'undefined'/);
  });

  it('lynx/tauri flavors inherit the same resolution', () => {
    const { files } = generateClients(CONFIG, ['lynx', 'tauri']);
    for (const f of ['lynx.ts', 'tauri.ts']) {
      assert.match(files[f]!, /method: 'HEAD'/, `${f} missing URL resolution`);
    }
  });
});

describe('deno and workers clients', () => {
  it('deno reads the wasm next to the module — no URL probing, no fetch', () => {
    const { files } = generateClients(CONFIG, ['deno']);
    const src = files['deno.ts']!;
    assert.match(src, /Deno\.readFile\(new URL\(WASM_FILE, import\.meta\.url\)\)/);
    assert.match(src, /WebAssembly\.compile\(bytes\)/);
    assert.doesNotMatch(src, /method: 'HEAD'/, 'deno must not probe URLs');
    assert.doesNotMatch(src, /\bfetch\(/, 'deno must not fetch — deno: URLs are unfetchable');
    assert.match(src, /createMinimalWasi/);
  });

  it('workers statically imports the wasm as the compiled module — no TLA', () => {
    const { files } = generateClients(CONFIG, ['workers']);
    const src = files['workers.ts']!;
    assert.match(src, /import wasmModule from '\.\/calc\.wasm'/);
    assert.match(src, /Promise\.resolve\(wasmModule\)/);
    assert.doesNotMatch(src, /await createClient\(/, 'module scope must stay await-free');
    assert.match(src, /createMinimalWasi/);
    const dts = files['wasm-module.d.ts']!;
    assert.match(dts, /declare module '\*\.wasm'/);
    assert.match(dts, /WebAssembly\.Module/);
  });
});

describe('drop-in clients', () => {
  // A resolved (inferred) profile carries source parameter names + docs.
  const PROFILE = {
    profile_format: 1,
    name: 'calc',
    entry: 'src/core.ts',
    emission: 'llvm',
    optimization: 'release',
    abi: { prefix: 'calc_', init_symbol: 'calc_init', sink_register_symbol: 'calc_sink' },
    exports: [
      { export: 'add', symbol: 'calc_add', params: ['f64', 'f64'], returns: 'f64', paramNames: ['a', 'b'], doc: 'Adds.' },
    ],
  } as unknown as ScriptcableProfile;

  it('browser drop-in mirrors the entry surface and awaits init once (TLA)', () => {
    const { files } = generateClients(CONFIG, ['browser'], { profile: PROFILE });
    const src = files['dropin/browser.ts']!;
    assert.match(src, /const client: ScriptcableClient = await createClient\(\);/, 'top-level await init');
    assert.match(src, /from '\.\.\/browser\.js'/);
    assert.match(src, /\/\*\* Adds\. \*\/\nexport function add\(a: number, b: number\): number \{\n  return client\.add\(a, b\);\n\}/);
    assert.match(src, /getScriptcableClient/);
  });

  it('node drop-in initializes synchronously — no await in code', () => {
    const { files } = generateClients(CONFIG, ['node']);
    const src = files['dropin/node.ts']!;
    assert.match(src, /from '\.\.\/node\.js'/);
    assert.match(src, /const client: ScriptcableClient = createClientSync\(\);/);
    assert.doesNotMatch(src, /await\s+createClient/, 'drop-in must be top-level-await-free (CJS-safe server bundles)');
    assert.match(src, /export function add\(arg0: number, arg1: number\): number/);
  });

  it('react-native drop-in creates the bridge client lazily', () => {
    const { files } = generateClients(CONFIG, ['react-native']);
    const src = files['dropin/react-native.ts']!;
    assert.match(src, /createTurboModuleBridge\(NativeCable\)/);
    assert.match(src, /cached \?\?= createClient/);
    assert.match(src, /return client\(\)\.add\(arg0, arg1\);/);
  });

  it('drop-ins appear only when their flavor is generated', () => {
    const onlyNode = generateClients(CONFIG, ['node']).files;
    assert.ok(onlyNode['dropin/node.ts']);
    assert.equal(onlyNode['dropin/browser.ts'], undefined);
    assert.equal(onlyNode['dropin/react-native.ts'], undefined);

    const onlyRn = generateClients(CONFIG, ['react-native']).files;
    assert.ok(onlyRn['dropin/react-native.ts']);
    assert.equal(onlyRn['dropin/node.ts'], undefined);
  });

  it('createClientSync exists on the node flavor and errors with the fix', () => {
    const { files } = generateClients(CONFIG, ['node']);
    const src = files['node.ts']!;
    assert.match(src, /export function createClientSync/);
    assert.match(src, /loadNativeLibrarySync/);
    assert.match(src, /loadAddonSync/);
    assert.match(src, /Run 'scriptcable build' first/);
    // The async path stays untouched
    assert.match(src, /export async function createClient/);
  });
});

describe('pre-bound per-export fns dispatch', () => {
  it('node/bun clients call pre-bound fns and tier by runtime', () => {
    const { files } = generateClients(CONFIG, ['node']);
    const src = files['node.ts']!;
    // shared-library + wasm tiers bind per-export functions
    assert.match(src, /const fns = mod\.fns;/);
    assert.match(src, /return fns\['add'\]\(/, 'methods go through pre-bound fns');
    // per-export methods must not fall back to generic call dispatch — the
    // batch() block may (wasm-tier batch routes via mod.call for uniform
    // single-call semantics), the `add` method itself may not
    assert.doesNotMatch(src, /mod\.call\('add'/, 'generic call dispatch must be gone from methods');
    // bun prefers the shared-library fast path; node keeps the addon first
    assert.match(src, /const IS_BUN = typeof \(globalThis as \{ Bun\?: unknown \}\)\.Bun !== 'undefined';/);
    assert.match(src, /if \(!IS_BUN && options\.addon !== false && !options\.sharedPath\) \{/);
    assert.match(src, /if \(!options\.preferWasm && !IS_BUN && options\.addon !== false && !options\.sharedPath\) \{/);
    // the addon stays a working fallback when the shared library is absent on Bun
    assert.match(src, /if \(IS_BUN && options\.addon !== false && !options\.sharedPath\) \{/);
    assert.match(src, /if \(IS_BUN && !options\.preferWasm && options\.addon !== false && !options\.sharedPath\) \{/);
  });

  it('addon tier hoists addonFns lookups into per-client consts', () => {
    const { files } = generateClients(CONFIG, ['node']);
    const src = files['node.ts']!;
    assert.match(src, /const __addon_add = addonFns\['add'\];/);
    assert.match(src, /return __addon_add\(/);
    assert.doesNotMatch(src, /addonFns\['add'\]\(/, 'no per-call property lookup on the addon tier');
  });

  it('browser/deno/workers/tauri/lynx wasm methods use pre-bound fns', () => {
    const browser = browserClient();
    assert.match(browser, /const fns = mod\.fns;/);
    assert.match(browser, /return fns\['add'\]\(/);
    const deno = generateClients(CONFIG, ['deno']).files['deno.ts']!;
    assert.match(deno, /const fns = mod\.fns;/);
    const workers = generateClients(CONFIG, ['workers']).files['workers.ts']!;
    assert.match(workers, /return fns\['add'\]\(/);
    const { files } = generateClients(CONFIG, ['tauri', 'lynx']);
    for (const f of ['tauri.ts', 'lynx.ts']) {
      assert.match(files[f]!, /const fns = mod\.fns;/, `${f} missing the fns hoist`);
      assert.match(files[f]!, /return fns\['add'\]\(/, `${f} not calling pre-bound fns`);
    }
  });
});

describe('batch surface', () => {
  const CONFIG = { name: 'calc', entry: 'src/core.ts' } as unknown as ResolvedConfig;
  const PROFILE = {
    profile_format: 1,
    name: 'calc',
    entry: 'src/core.ts',
    emission: 'llvm',
    abi: { prefix: 'calc_', init_symbol: 'calc_init', sink_register_symbol: 'calc_sink' },
    exports: [
      { export: 'add', symbol: 'calc_add', params: ['f64', 'f64'], returns: 'f64' },
      { export: 'greet', symbol: 'calc_greet', params: ['string'], returns: 'string' },
    ],
  } as unknown as ScriptcableProfile;

  it('node flavor wires the addon executive into batch() with a sequential fallback', () => {
    const src = generateClients(CONFIG, ['node'], { profile: PROFILE }).files['node.ts']!;
    assert.match(src, /import \{ createBatchWire \} from '@scriptcable\/core\/batch';/);
    assert.match(src, /const __wire = createBatchWire\(PROFILE\);/, 'one wire per client module');
    assert.match(
      src,
      /const __execBatch = addonFns\['__scriptcable_batch'\] as \(\(meta: Int32Array, args: Uint8Array\) => Uint8Array\) \| undefined;/,
    );
    assert.match(src, /return __wire\.decode\(__execBatch\(meta, args\)\);/);
    // direct-tier sequential fallback validates via the wire so unknown/argc
    // errors are the same class no matter which tier is active (review F-5)
    assert.match(src, /__wire\.check\(entries\);/);
    assert.match(src, /addonFns\[e\[0\]\]\(\.\.\.\(e\.slice\(1\) as unknown\[\]\)\)/, 'direct-tier fallback dispatches addonFns');
  });

  it('shared tier routes by composition — bun numeric batches keep the ffi loop', () => {
    const src = generateClients(CONFIG, ['node'], { profile: PROFILE }).files['node.ts']!;
    assert.match(src, /const __MARSHALED = new Set<string>\(MARSHALED_EXPORTS\);/);
    assert.match(src, /const needsCodec = entries\.some\(\(e\) => __MARSHALED\.has\(e\[0\]\)\);/);
    // addon executive: always on Node, marshaled-only on Bun (ffi direct
    // numeric singles ~16 ns/op beat any batch — measured 2026-10-25)
    assert.match(src, /if \(typeof __execBatch === 'function' && \(!IS_BUN \|\| needsCodec\)\) \{/);
    // everything else (numeric-on-Bun, hosts without the addon) rides the
    // loader — which routes the shared library's own executive the same way
    assert.match(src, /return mod\.batch\(entries\);/);
  });

  it('wasm flavors batch through mod.call so errors match single calls', () => {
    const browser = generateClients(CONFIG, ['browser'], { profile: PROFILE }).files['browser.ts']!;
    assert.doesNotMatch(browser, /createBatchWire/, 'browser graphs must not pull the node wire module');
    assert.match(browser, /return entries\.map\(\(e\) => mod\.call\(e\[0\], \.\.\.\(e\.slice\(1\) as unknown\[\]\)\)\);/);
    const deno = generateClients(CONFIG, ['deno'], { profile: PROFILE }).files['deno.ts']!;
    assert.match(deno, /mod\.call\(e\[0\]/);
    const workers = generateClients(CONFIG, ['workers'], { profile: PROFILE }).files['workers.ts']!;
    assert.match(workers, /mod\.call\(e\[0\]/);
  });

  it('shared tier binds the executive from a nullable addon lookup', () => {
    const src = generateClients(CONFIG, ['node'], { profile: PROFILE }).files['node.ts']!;
    assert.match(src, /const addonFns = IS_BUN && options\.addon !== false \? loadAddonSync\(\) : null;/);
    assert.match(src, /const addonFns = IS_BUN && options\.addon !== false \? await loadAddon\(\) : null;/);
    assert.match(src, /__execBatch = addonFns === null \? undefined :/);
  });

  it('wasm flavors batch sequentially — an in-boundary batch is upstream territory', () => {
    const browser = generateClients(CONFIG, ['browser'], { profile: PROFILE }).files['browser.ts']!;
    assert.match(browser, /mod\.call\(e\[0\]/);
    const deno = generateClients(CONFIG, ['deno'], { profile: PROFILE }).files['deno.ts']!;
    assert.match(deno, /mod\.call\(e\[0\]/);
  });

  it('the react-native client batches through the bridge', () => {
    const src = generateClients(CONFIG, ['react-native'], { profile: PROFILE }).files['react-native.ts']!;
    assert.match(src, /return entries\.map\(\(e\) => bridge\.call\(e\[0\], e\.slice\(1\) as unknown\[\]\)\) as unknown\[\];/);
  });

  it('ScriptcableClient declares batch(entries)', () => {
    const types = generateClients(CONFIG, ['node'], { profile: PROFILE }).files['types.ts']!;
    assert.match(types, /import type \{ BatchEntry \} from '@scriptcable\/types';/);
    assert.match(types, /batch\(entries: ReadonlyArray<BatchEntry>\): unknown\[\];/);
  });
});
