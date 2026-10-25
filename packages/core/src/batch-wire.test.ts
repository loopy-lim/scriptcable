import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { createBatchWire } from './batch-wire.js';
import type { ScriptcableProfile } from '@scriptcable/types';

const PROFILE: ScriptcableProfile = {
  profile_format: 1,
  name: 'demo',
  entry: 'src/core.ts',
  emission: 'llvm',
  abi: { prefix: 'demo_', init_symbol: 'demo_init', sink_register_symbol: 'demo_sink' },
  exports: [
    { export: 'add', symbol: 'demo_add', params: ['f64', 'f64'], returns: 'f64' },
    { export: 'repeat', symbol: 'demo_repeat', params: ['string', 'f64'], returns: 'string' },
    { export: 'concat', symbol: 'demo_concat', params: ['string', 'string'], returns: 'string' },
    { export: 'cc', symbol: 'demo_cc', params: ['cstring', 'cstring'], returns: 'cstring' },
    { export: 'echo', symbol: 'demo_echo', params: ['bytes'], returns: 'bytes' },
    { export: 'big', symbol: 'demo_big', params: ['i64'], returns: 'i64' },
    { export: 'ubig', symbol: 'demo_ubig', params: ['u64'], returns: 'u64' },
    { export: 'flag', symbol: 'demo_flag', params: ['bool'], returns: 'bool' },
    { export: 'id', symbol: 'demo_id', params: ['u32'], returns: 'u32' },
    { export: 'sid', symbol: 'demo_sid', params: ['i32'], returns: 'i32' },
    { export: 'noop', symbol: 'demo_noop', params: [], returns: 'void' },
  ],
};

describe('batch-wire', () => {
  it('rejects unknown exports and wrong arg counts before anything crosses', () => {
    const wire = createBatchWire(PROFILE);
    assert.throws(() => wire.encode([['nope', 1]]), /Unknown export/);
    assert.throws(() => wire.encode([['add', 1]]), /expects 2 arguments, got 1/);
    assert.throws(() => wire.encode([['repeat', 'ab', 2, 3]]), /expects 2 arguments, got 3/);
  });

  it('produces a deterministic meta header: [count, (idx, argBase) × count]', () => {
    const wire = createBatchWire(PROFILE);
    const addIdx = PROFILE.exports.findIndex((e) => e.export === 'add');
    const repeatIdx = PROFILE.exports.findIndex((e) => e.export === 'repeat');
    const { meta, args } = wire.encode([
      ['add', 20, 22],
      ['repeat', 'ab', 100],
    ]);
    assert.equal(meta[0], 2);
    assert.equal(meta[1], addIdx);
    assert.equal(meta[3], repeatIdx);
    // slots are 8-byte aligned and within args
    const addBase = meta[2]!;
    const repeatBase = meta[4]!;
    assert.equal(addBase % 8, 0);
    assert.equal(repeatBase % 8, 0);
    // add has no payloads: its slots start right at the beginning
    assert.equal(addBase, 0);
    assert.ok(repeatBase + 16 <= args.byteLength);
  });

  it('writes string payloads utf8 with (off, len) slots — multibyte included', () => {
    const wire = createBatchWire(PROFILE);
    const { meta, args } = wire.encode([['concat', 'héllo→', '세상']]);
    const dv = new DataView(args.buffer);
    const base = meta[2]!;
    for (let p = 0; p < 2; p++) {
      const off = dv.getUint32(base + 8 * p, true);
      const len = dv.getUint32(base + 8 * p + 4, true);
      assert.ok(off + len <= args.byteLength);
      const text = new TextDecoder().decode(args.subarray(off, off + len));
      assert.equal(text, p === 0 ? 'héllo→' : '세상');
    }
  });

  it('appends a NUL to cstring payloads and counts it in the slot length', () => {
    const wire = createBatchWire(PROFILE);
    const { meta, args } = wire.encode([['cc', 'a', '']]);
    const dv = new DataView(args.buffer);
    const base = meta[2]!;
    const off = dv.getUint32(base, true);
    const len = dv.getUint32(base + 4, true);
    assert.equal(len, 2); // 'a' + NUL
    assert.equal(args[off]!, 97);
    assert.equal(args[off + 1]!, 0);
    // empty cstring: just the NUL
    const off1 = dv.getUint32(base + 8, true);
    const len1 = dv.getUint32(base + 12, true);
    assert.equal(len1, 1);
    assert.equal(args[off1]!, 0);
  });

  it('carries i64/u64 as raw 8-byte slots (number and BigInt inputs)', () => {
    const wire = createBatchWire(PROFILE);
    const { meta, args } = wire.encode([
      ['big', 4503599627370495],
      ['ubig', BigInt('18446744073709551615')],
    ]);
    const dv = new DataView(args.buffer);
    assert.equal(dv.getBigInt64(meta[2]!, true), 4503599627370495n);
    assert.equal(dv.getBigUint64(meta[4]!, true), 18446744073709551615n);
  });

  it('encodes bool/small ints as f64 slots (C casts from double)', () => {
    const wire = createBatchWire(PROFILE);
    const { meta, args } = wire.encode([
      ['flag', true],
      ['id', 4294967295],
      ['sid', -5],
    ]);
    const dv = new DataView(args.buffer);
    assert.equal(dv.getFloat64(meta[2]!, true), 1);
    assert.equal(dv.getFloat64(meta[4]!, true), 4294967295);
    assert.equal(dv.getFloat64(meta[6]!, true), -5);
  });

  it('reuses pools across encodes when capacity suffices (AC-2), grows when not', () => {
    const wire = createBatchWire(PROFILE);
    const a = wire.encode([['add', 1, 2]]);
    const b = wire.encode([['add', 3, 4]]);
    assert.equal(a.args, b.args); // same buffer identity — no per-batch allocation
    assert.equal(a.meta, b.meta);
    // large payload forces growth; new pools keep serving
    const big = 'x'.repeat(64 * 1024);
    const grown = wire.encode([['repeat', big, 1]]);
    assert.ok(grown.args.byteLength >= 64 * 1024);
    const after = wire.encode([['add', 5, 6]]);
    assert.equal(grown.args, after.args);
    assert.notEqual(a.args, grown.args);
  });

  it('handles zero entries and empty-string payloads', () => {
    const wire = createBatchWire(PROFILE);
    const { meta } = wire.encode([]);
    assert.equal(meta[0], 0);
    const { args } = wire.encode([['concat', '', '']]);
    // two empty payloads still write (off, 0) slots
    const dv = new DataView(args.buffer);
    assert.equal(dv.getUint32(meta[2]! + 4, true), 0);
    assert.equal(dv.getUint32(meta[2]! + 12, true), 0);
  });

  it('decodes a self-describing result block (simulated executive output)', () => {
    const wire = createBatchWire(PROFILE);
    // Simulate what the C executive writes: [kind, payload] per entry.
    const out: number[] = [];
    const put = (kind: number) => out.push(kind, 0, 0, 0);
    const pushF64 = (v: number) => {
      const b = new DataView(new ArrayBuffer(8));
      b.setFloat64(0, v, true);
      for (const byte of new Uint8Array(b.buffer)) out.push(byte);
    };
    const pushU32 = (v: number) => out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    const pushWide = (write: (dv: DataView) => void) => {
      const b = new DataView(new ArrayBuffer(8));
      write(b);
      for (const byte of new Uint8Array(b.buffer)) out.push(byte);
    };
    const text = new TextEncoder().encode('héllo');
    put(7); pushU32(text.byteLength); for (const byte of text) out.push(byte); // string
    put(1); pushF64(3.5); // f64
    put(2); pushU32(1); // bool
    put(3); pushU32(4294967295); // u32
    put(4); pushU32(4294967040); // i32 -256
    put(5); pushWide((dv) => dv.setBigInt64(0, -9007199254740991n, true)); // i64
    put(6); pushWide((dv) => dv.setBigUint64(0, 18446744073709551615n, true)); // u64
    put(8); pushU32(3); out.push(1, 2, 3); // bytes
    put(9); pushU32(2); out.push(104, 105); // cstring 'hi'
    put(10); // void
    const results = wire.decode(Uint8Array.from(out));
    assert.deepEqual(results, [
      'héllo',
      3.5,
      true,
      4294967295,
      -256,
      -9007199254740991,
      18446744073709551615,
      Uint8Array.from([1, 2, 3]),
      'hi',
      undefined,
    ]);
  });

  it('rejects a corrupt result block instead of returning garbage', () => {
    const wire = createBatchWire(PROFILE);
    assert.throws(() => wire.decode(Uint8Array.from([99, 0, 0, 0])), /Corrupt batch result block/);
  });
});
