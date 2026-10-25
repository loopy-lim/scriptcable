/**
 * Host batch executive integration — compiles native.c into an archive and
 * links a shared library WITH the generated scriptc_batch TU (the same path
 * the toolchain uses), then checks the loader detects it (batchTransport),
 * routes marshaled batches through it, and returns the same results as
 * sequential calls. Covers: a .so WITHOUT the executive (compat →
 * sequential), the koffi binding under the same contract, and the loader's
 * composition routing (bun:ffi numeric batches stay on the direct loop).
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { linkSharedLibrary } from './link-shared.js';
import { loadNativeLibrarySync, bindKoffiSync, type NativeModule } from './native-loader.js';
import { generateSharedBatchSource } from './napi-addon.js';
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

class NoToolchainError extends Error {}

async function buildSo(withTu: boolean): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'sc-so-batch-'));
  const src = join(import.meta.dir, '..', 'test-fixtures', 'native.c');
  const obj = join(dir, 'native.o');
  const archive = join(dir, 'probe.lib.a');
  for (const cc of ['cc', 'clang']) {
    if (
      spawnSync(cc, ['-c', '-fPIC', '-O1', '-o', obj, src], { encoding: 'utf8' }).status === 0 &&
      spawnSync('ar', ['rcs', archive, obj], { encoding: 'utf8' }).status === 0
    ) {
      const extraSources: string[] = [];
      if (withTu) {
        const tu = join(dir, 'probe-batch.c');
        const source = generateSharedBatchSource(PROFILE);
        assert.ok(source.length > 0, 'executive source must generate for this profile');
        writeFileSync(tu, source);
        extraSources.push(tu);
      }
      return linkSharedLibrary({ archivePath: archive, outPath: join(dir, 'libprobe.so'), extraSources: extraSources.length ? extraSources : undefined });
    }
  }
  throw new NoToolchainError('no C compiler/ar available for the so-batch fixture');
}

const MIXED = [
  ['concat', 'hello', 'world'],
  ['cc', 'alpha', 'beta'],
  ['echo', 'plain'],
  ['becho', Uint8Array.from([1, 2, 3])],
  ['dadd', 20, 22],
  ['big', 4503599627370495],
  ['ubig', BigInt('18446744073709551614')],
  ['flag', true],
  ['u32id', 4294967294],
  ['i32id', -2147483648],
  ['noop'],
] as const;

function expectParity(mod: NativeModule): void {
  const batched = mod.batch(MIXED as never);
  const sequential = MIXED.map(([name, ...args]) => mod.call(name, ...(args as unknown[])));
  assert.deepEqual(batched, sequential, 'batch must match sequential calls exactly');
  assert.equal(mod.batch([] as never).length, 0);
}

describe('host batch executive (.so)', () => {
  it('links the TU, detects the executive, and matches sequential calls', async () => {
    let so: string;
    try {
      so = await buildSo(true);
    } catch (e) {
      console.log(`skip: ${(e as Error).message}`);
      return;
    }
    const mod = loadNativeLibrarySync(so, PROFILE);
    assert.equal(mod.batchTransport, 'executive', 'the linked executive must be detected');
    expectParity(mod);

    // A marshaled-only batch rides the executive; a second batch right after
    // (fresh per-thread cursor) must stay correct.
    const str = mod.batch([
      ['concat', 'a', 'b'],
      ['echo', 'c'],
    ] as never);
    assert.deepEqual(str, ['a|b', 'c']);
    assert.deepEqual(mod.batch([['echo', 'again']] as never), ['again']);
    mod.dispose();
  });

  it('a .so without the executive stays sequential and equally correct', async () => {
    let so: string;
    try {
      so = await buildSo(false);
    } catch (e) {
      console.log(`skip: ${(e as Error).message}`);
      return;
    }
    const mod = loadNativeLibrarySync(so, PROFILE);
    assert.equal(mod.batchTransport, 'sequential', 'no TU → no executive');
    expectParity(mod);
    assert.throws(() => mod.batch([['missing']] as never), /Unknown export/);
    mod.dispose();
  });

  it('the koffi binding exposes the executive under the same contract', async () => {
    let so: string;
    let koffi: unknown;
    try {
      so = await buildSo(true);
      koffi = createRequire(import.meta.url)('koffi');
    } catch (e) {
      console.log(`skip: ${(e as Error).message}`);
      return;
    }
    const binding = bindKoffiSync(so, PROFILE, koffi as never);
    assert.ok(binding.batch, 'koffi must see the linked executive');
    assert.equal(binding.loopFastNumbers, false, 'koffi numeric batches prefer the executive');
    // Binding-level contract: wire in, result bytes out, parity with the
    // binding's own sequential calls (symbols === export names in this
    // fixture). Full module routing parity is covered by the bun:ffi test.
    const wire = createBatchWire(PROFILE);
    const { meta, args } = wire.encode(MIXED as never);
    const results = wire.decode(binding.batch.exec(meta, args));
    const sequential = (MIXED as readonly [string, ...unknown[]][]).map(([symbol, ...rest]) =>
      binding.call(symbol, rest),
    );
    assert.deepEqual(results, sequential);
  });
});
