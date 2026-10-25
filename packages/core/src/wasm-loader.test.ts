/**
 * Loader regression tests against a freestanding wasm fixture that models the
 * scriptc runtime contract (test-fixtures/wasm-side.c — its scriptc_free
 * POISONS freed ranges with 0xDE, so any use-after-free shows up as garbage).
 *
 * Guards the boundary-marshaling round (2026-10-25):
 *   - F1: a host callback re-entering another export must not leak the outer
 *     call's marshaled arguments into the inner one (shared wasmArgs).
 *   - F2: mid-call scratch growth must not free regions earlier parameters of
 *     the SAME call still point into.
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadWasmModule } from './wasm-loader.js';

const FIXTURE = join(import.meta.dir, '..', 'test-fixtures', 'wasm-side.wasm');
const FIXTURE2 = join(import.meta.dir, '..', 'test-fixtures', 'wasm-side2.wasm');

const PROFILE = {
  profile_format: 2 as const,
  name: 'probew',
  entry: 'wasm-side.c',
  emission: 'llvm' as const,
  abi: {
    prefix: 'probe_',
    init_symbol: 'probe_init',
    sink_register_symbol: 'probe_noop',
    callback_register_symbol: '',
  },
  exports: [
    { export: 'concat2', symbol: 'probe_concat2', params: ['string', 'string'] as const, returns: 'string' as const },
    { export: 'echo', symbol: 'probe_echo', params: ['string'] as const, returns: 'string' as const },
    { export: 'outer', symbol: 'probe_outer', params: ['string'] as const, returns: 'i32' as const },
    { export: 'inner', symbol: 'probe_inner', params: ['i32', 'i32'] as const, returns: 'i32' as const },
  ],
  callbacks: [{ name: 'cb', params: ['i32'] as const, returns: 'i32' as const }],
};

async function load(callbacks: Record<string, (...args: unknown[]) => unknown> = {}) {
  const bytes = await Bun.file(FIXTURE).bytes();
  return loadWasmModule(bytes, { profile: PROFILE as never, wasi: {}, callbacks });
}

describe('wasm-loader marshaling regressions', () => {
  it('concat2 keeps both string parameters distinct (per-param scratch offsets)', async () => {
    const mod = await load();
    assert.equal(mod.fns.concat2('hello', 'world'), 'hello|world');
    assert.equal(mod.fns.concat2('abc', 'def'), 'abc|def');
    mod.dispose();
  });

  it('mid-call scratch growth does not free earlier parameters (F2 — freed ranges read back as 0xDE)', async () => {
    const mod = await load();
    // Two ~900-char strings: each writeString reserves 4×len+4 (> the 1 KiB
    // initial scratch), so the second bump grows the region mid-call.
    const a = 'a'.repeat(900);
    const b = 'b'.repeat(900);
    const out = mod.fns.concat2(a, b) as string;
    const [outA, outB] = out.split('|');
    assert.equal(outA, a, 'first parameter must survive the mid-call growth');
    assert.equal(outB, b, 'second parameter must be read from live memory');
    assert.ok(!out.includes('�'), 'no poison bytes — nothing was read from freed memory');
    // Single long param: same growth path without a second parameter.
    assert.equal(mod.fns.echo('x'.repeat(2000)), 'x'.repeat(2000));
    mod.dispose();
  });

  it('re-entrant call from a host callback sees only its own arguments (F1 — shared wasmArgs)', async () => {
    let innerResult: number | null = null;
    const mod = await load({
      // wasm calls cb(7) inside probe_outer; the host re-enters inner(100,200).
      cb: () => {
        innerResult = mod.fns.inner(100, 200) as number;
        return innerResult;
      },
    });
    const outer = mod.fns.outer('x', 1) as number;
    assert.equal(innerResult, 300, 'inner(100,200) must receive exactly its own args, not the outer call\'s ptr/len');
    assert.equal(outer, 300, 'outer returns what the callback returned');
    mod.dispose();
  });

  it('growth × re-entrancy: an inner frame must not free the outer call\'s retired regions (F6)', async () => {
    // probe_concat3 reads param a (in the retired region after the mid-call
    // growth), invokes the host callback, then re-reads a — if the INNER
    // frame's finally freed/cleared st.retired, the re-read sees 0xDE poison.
    const bytes = await Bun.file(FIXTURE2).bytes();
    const profile = {
      ...PROFILE,
      name: 'probew2',
      entry: 'wasm-side2.c',
      exports: [
        { export: 'concat3', symbol: 'probe_concat3', params: ['string', 'string'] as const, returns: 'string' as const },
        { export: 'inner', symbol: 'probe_inner2', params: ['i32', 'i32'] as const, returns: 'i32' as const },
      ],
    };
    let innerResult: number | null = null;
    const mod = await loadWasmModule(bytes, {
      profile: profile as never,
      wasi: {},
      callbacks: {
        cb: () => {
          innerResult = mod.fns.inner(30, 40) as number;
          return 0;
        },
      },
    });
    const a = 'a'.repeat(300);
    const b = 'b'.repeat(300);
    const out = mod.fns.concat3(a, b) as string;
    const [outA, outB] = out.split('|');
    assert.equal(innerResult, 70, 're-entrant inner(30,40) must see exactly its own args');
    assert.equal(outA, a, 'param a (retired region) must survive the inner frame\'s finally');
    assert.equal(outB, b, 'param b must survive the inner frame\'s finally');
    assert.ok(!out.includes('�'), 'no poison bytes — retired regions freed only by the shared frame');
    mod.dispose();
  });
});
