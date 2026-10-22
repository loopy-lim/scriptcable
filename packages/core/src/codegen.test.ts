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
