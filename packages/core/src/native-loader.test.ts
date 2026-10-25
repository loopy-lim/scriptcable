/**
 * bun:ffi marshaling regression tests against a compiled-on-the-fly fixture
 * (test-fixtures/native.c — two-string concat, two-cstring concat, long echo).
 *
 * Guards the boundary-marshaling round (2026-10-25):
 *   - F3: multiple string/bytes/cstring parameters must each get their own
 *     scratch region (they used to alias into one shared buffer).
 *   - F5: a cstring return must be decoded, not handed back as a raw pointer.
 * Skips when no C compiler is available (mirrors the addon's soft-fail).
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadNativeLibrarySync } from './native-loader.js';

const PROFILE = {
  profile_format: 2 as const,
  name: 'probe',
  entry: 'native.c',
  emission: 'llvm' as const,
  abi: {
    prefix: 'probe_',
    init_symbol: 'probe_init',
    sink_register_symbol: 'probe_noop',
    callback_register_symbol: '',
  },
  exports: [
    { export: 'concat', symbol: 'concat', params: ['string', 'string'] as const, returns: 'string' as const },
    { export: 'cc', symbol: 'cc', params: ['cstring', 'cstring'] as const, returns: 'cstring' as const },
    { export: 'echo', symbol: 'echo', params: ['string'] as const, returns: 'string' as const },
  ],
  callbacks: [],
};

function compileFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sc-native-fx-'));
  const src = join(import.meta.dir, '..', 'test-fixtures', 'native.c');
  const so = join(dir, 'native.so');
  for (const cc of ['cc', 'clang']) {
    const r = spawnSync(cc, ['-shared', '-fPIC', '-O1', '-o', so, src], { encoding: 'utf8' });
    if (r.status === 0) return so;
  }
  throw new Error('no C compiler (cc/clang) available for the native fixture');
}

describe('native-loader marshaling regressions', () => {
  it('concat keeps both string parameters distinct (F3 — per-param scratch regions)', () => {
    let so: string;
    try {
      so = compileFixture();
    } catch (e) {
      console.log(`skip: ${(e as Error).message}`);
      return;
    }
    const mod = loadNativeLibrarySync(so, PROFILE as never);
    assert.equal(mod.fns.concat('hello', 'world'), 'hello|world', 'two string params must not alias');
    assert.equal(mod.fns.concat('abc', 'def'), 'abc|def');
    // Growth: 2 KiB total far exceeds the 1 KiB initial scratch — the bumped
    // buffer is replaced mid-call and must stay alive for the call (retired).
    const a = 'a'.repeat(1500);
    const b = 'b'.repeat(1500);
    assert.equal(mod.fns.concat(a, b), `${a}|${b}`);
    mod.dispose();
  });

  it('multi-cstring params stay distinct and the cstring return decodes (F3+F5)', () => {
    let so: string;
    try {
      so = compileFixture();
    } catch (e) {
      console.log(`skip: ${(e as Error).message}`);
      return;
    }
    const mod = loadNativeLibrarySync(so, PROFILE as never);
    const r = mod.fns.cc('alpha', 'beta');
    assert.equal(r, 'alpha/beta', 'cstring return must decode — not a raw pointer number');
    assert.equal(typeof r, 'string');
    mod.dispose();
  });
});
