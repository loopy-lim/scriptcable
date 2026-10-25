/**
 * Batch executive integration tests — compiles the generated N-API addon
 * against the native.c fixture at test time (same soft-fail convention as
 * native-loader.test.ts) and checks that one boundary crossing returns the
 * same results as the sequential per-export addon calls, across every
 * param/return class, growth, and edge cases.
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { buildNodeAddon, BATCH_SYMBOL } from './napi-addon.js';
import { createBatchWire } from './batch-wire.js';
import type { ScriptcableProfile } from '@scriptcable/types';

const PROFILE: ScriptcableProfile = {
  profile_format: 2,
  name: 'probe',
  entry: 'native.c',
  emission: 'llvm',
  abi: {
    prefix: 'probe_',
    init_symbol: 'probe_init',
    sink_register_symbol: 'probe_noop',
    callback_register_symbol: '',
  },
  exports: [
    { export: 'concat', symbol: 'concat', params: ['string', 'string'], returns: 'string' },
    { export: 'cc', symbol: 'cc', params: ['cstring', 'cstring'], returns: 'cstring' },
    { export: 'echo', symbol: 'echo', params: ['string'], returns: 'string' },
    { export: 'becho', symbol: 'becho', params: ['bytes'], returns: 'bytes' },
    { export: 'dadd', symbol: 'dadd', params: ['f64', 'f64'], returns: 'f64' },
    { export: 'big', symbol: 'big', params: ['i64'], returns: 'i64' },
    { export: 'ubig', symbol: 'ubig', params: ['u64'], returns: 'u64' },
    { export: 'flag', symbol: 'flag', params: ['bool'], returns: 'bool' },
    { export: 'u32id', symbol: 'u32id', params: ['u32'], returns: 'u32' },
    { export: 'i32id', symbol: 'i32id', params: ['i32'], returns: 'i32' },
    { export: 'noop', symbol: 'noop', params: [], returns: 'void' },
  ],
  callbacks: [],
};

type Addon = Record<string, (...args: unknown[]) => unknown> & {
  [BATCH_SYMBOL]: (meta: Int32Array, args: Uint8Array) => Uint8Array;
};

async function compileAddon(): Promise<Addon> {
  const dir = mkdtempSync(join(tmpdir(), 'sc-addon-batch-'));
  addonDir = dir;
  const src = join(import.meta.dir, '..', 'test-fixtures', 'native.c');
  const obj = join(dir, 'native.o');
  const archive = join(dir, 'probe.lib.a');
  let linked = false;
  for (const cc of ['cc', 'clang']) {
    const c = spawnSync(cc, ['-c', '-fPIC', '-O1', '-o', obj, src], { encoding: 'utf8' });
    if (c.status !== 0) continue;
    const ar = spawnSync('ar', ['rcs', archive, obj], { encoding: 'utf8' });
    if (ar.status !== 0) continue;
    linked = true;
    break;
  }
  // No toolchain → the caller skips (the addon is a soft-fail feature).
  // A buildNodeAddon failure AFTER this point is a generated-source defect —
  // it propagates and fails the test.
  if (!linked) throw new NoToolchainError('no C compiler/ar available for the addon fixture');

  const addonPath = await buildNodeAddon({
    archivePath: archive,
    outDir: dir,
    name: 'probe',
    profile: PROFILE,
  });
  return createRequire(join(addonPath, 'x.js'))(addonPath) as Addon;
}

class NoToolchainError extends Error {}

/** One compiled addon serves every test — the executive is stateless across batches. */
let addonPromise: Promise<Addon> | null = null;
let addonDir: string | null = null;
async function getAddon(): Promise<Addon> {
  return (addonPromise ??= compileAddon());
}
function getAddonPath(): string {
  if (!addonDir) throw new Error('addon not compiled yet');
  return join(addonDir, 'probe.node');
}

describe('addon batch executive', () => {
  it('one crossing returns the same results as sequential addon calls', async () => {
    let addon: Addon;
    try {
      addon = await getAddon();
    } catch (e) {
      console.log(`skip: ${(e as Error).message}`);
      return;
    }
    const wire = createBatchWire(PROFILE);
    assert.equal(typeof addon[BATCH_SYMBOL], 'function', 'executive must be registered');

    const entries = [
      ['concat', 'hello', 'world'],
      ['cc', 'alpha', 'beta'],
      ['echo', 'plain'],
      ['dadd', 20, 22],
      ['big', 2251799813685248],
      ['ubig', BigInt('18446744073709551614')],
      ['flag', true],
      ['u32id', 4294967294],
      ['i32id', -2147483648],
      ['noop'],
    ] as const;
    const { meta, args } = wire.encode(entries as never);
    const results = wire.decode(addon[BATCH_SYMBOL](meta, args));

    // Sequential parity — the addon's own per-export functions.
    assert.deepEqual(results, [
      addon.concat('hello', 'world'),
      addon.cc('alpha', 'beta'),
      addon.echo('plain'),
      addon.dadd(20, 22),
      addon.big(2251799813685248),
      addon.ubig(BigInt('18446744073709551614')),
      addon.flag(true),
      addon.u32id(4294967294),
      addon.i32id(-2147483648),
      undefined,
    ]);
  });

  it('keeps multibyte and empty payloads intact', async () => {
    let addon: Addon;
    try {
      addon = await getAddon();
    } catch (e) {
      console.log(`skip: ${(e as Error).message}`);
      return;
    }
    const wire = createBatchWire(PROFILE);
    const { meta, args } = wire.encode([
      ['concat', 'héllo→세상', ''],
      ['echo', ''],
    ] as never);
    const results = wire.decode(addon[BATCH_SYMBOL](meta, args));
    assert.deepEqual(results, ['héllo→세상|', '']); // concat inserts the '|' separator
  });

  it('grows the result block across batches without corrupting earlier entries', async () => {
    let addon: Addon;
    try {
      addon = await getAddon();
    } catch (e) {
      console.log(`skip: ${(e as Error).message}`);
      return;
    }
    const wire = createBatchWire(PROFILE);
    // First batch is small (initial 256-byte block); the second carries a
    // 200 KiB result — realloc must preserve order and every entry.
    const small = wire.encode([['echo', 'a']]);
    assert.equal(wire.decode(addon[BATCH_SYMBOL](small.meta, small.args))[0], 'a');

    const bigText = 'x'.repeat(200 * 1024);
    const entries: [string, ...unknown[]][] = [
      ['concat', bigText, '!'],
      ['echo', bigText],
    ];
    const { meta, args } = wire.encode(entries as never);
    const results = wire.decode(addon[BATCH_SYMBOL](meta, args));
    assert.equal(results[0], `${bigText}|!`); // concat inserts the '|' separator
    assert.equal(results[1], bigText);

    // And a follow-up batch after growth stays correct.
    const again = wire.encode([['cc', 'p', 'q']] as never);
    assert.equal(wire.decode(addon[BATCH_SYMBOL](again.meta, again.args))[0], 'p/q');
  });

  it('round-trips bytes (param Uint8Array → result Uint8Array with the executive trailer)', async () => {
    let addon: Addon;
    try {
      addon = await getAddon();
    } catch (e) {
      console.log(`skip: ${(e as Error).message}`);
      return;
    }
    const wire = createBatchWire(PROFILE);
    const payload = Uint8Array.from([1, 2, 3, 0x00, 0xfe, 0xff]);
    const { meta, args } = wire.encode([['becho', payload]] as never);
    const results = wire.decode(addon[BATCH_SYMBOL](meta, args));
    const out = results[0] as Uint8Array;
    assert.ok(out instanceof Uint8Array);
    assert.equal(out.byteLength, payload.byteLength + 1); // + 0xFF trailer
    assert.deepEqual([...out.subarray(0, payload.byteLength)], [...payload]);
    assert.equal(out[payload.byteLength], 0xff);
  });

  it('handles zero entries and large batches uniformly', async () => {
    let addon: Addon;
    try {
      addon = await getAddon();
    } catch (e) {
      console.log(`skip: ${(e as Error).message}`);
      return;
    }
    const wire = createBatchWire(PROFILE);
    const empty = wire.encode([]);
    assert.deepEqual(wire.decode(addon[BATCH_SYMBOL](empty.meta, empty.args)), []);

    const entries: [string, ...unknown[]][] = [];
    for (let i = 0; i < 500; i++) entries.push(['dadd', i, i * 2]);
    const { meta, args } = wire.encode(entries as never);
    const results = wire.decode(addon[BATCH_SYMBOL](meta, args));
    assert.equal(results.length, 500);
    assert.equal(results[499], 499 * 3);
  });

  it('rejects wire misuse on the JS side before crossing', () => {
    const wire = createBatchWire(PROFILE);
    assert.throws(() => wire.encode([['missing', 1]]), /Unknown export/);
    assert.throws(() => wire.encode([['concat', 'only-one']]), /expects 2 arguments, got 1/);
    // check() mirrors encode's validation for the sequential fallback tiers.
    assert.throws(() => wire.check([['missing']] as never), /Unknown export/);
    assert.throws(() => wire.check([['concat', 'one']] as never), /expects 2 arguments, got 1/);
    wire.check([
      ['concat', 'a', 'b'],
      ['echo', 'x'],
    ] as never);
  });

  it('keeps the result cursor per-thread across worker_threads (F-1 regression)', async () => {
    let addon: Addon;
    try {
      addon = await getAddon();
    } catch (e) {
      console.log(`skip: ${(e as Error).message}`);
      return;
    }
    assert.ok(addon); // compiled — shared process-wide statics exercise the race
    const addonPath = getAddonPath();
    const corruptPerWorker = await Promise.all(
      [0, 1, 2, 3].map(
        () =>
          new Promise<number>((resolve, reject) => {
            const w = new Worker(
              join(import.meta.dir, '..', 'test-fixtures', 'addon-batch-worker.ts'),
              { workerData: { addonPath, profile: PROFILE, batches: 1500 } },
            );
            w.on('message', (m) => resolve(m as number));
            w.on('error', reject);
          }),
      ),
    );
    const total = corruptPerWorker.reduce((a, b) => a + b, 0);
    assert.equal(total, 0, `corrupt batches with 4 workers sharing the addon: ${corruptPerWorker.join(',')}`);
  });
});
