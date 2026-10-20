import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { snapshotFromConfig, diffContracts } from './contract.js';
import type { ScriptcableConfig } from '@scriptcable/types';

const base: ScriptcableConfig = {
  name: 'calc',
  entry: 'src/core.ts',
  prefix: 'calc_',
  exports: [
    { name: 'add', params: ['f64', 'f64'], returns: 'f64' },
    { name: 'mul', params: ['f64', 'f64'], returns: 'f64' },
  ],
};

describe('contract', () => {
  it('hashes stably', () => {
    const a = snapshotFromConfig(base);
    const b = snapshotFromConfig(base);
    assert.equal(a.hash, b.hash);
  });

  it('detects breaking removal', () => {
    const before = snapshotFromConfig(base);
    const after = snapshotFromConfig({
      ...base,
      exports: [{ name: 'add', params: ['f64', 'f64'], returns: 'f64' }],
    });
    const d = diffContracts(before, after);
    assert.equal(d.breaking.length, 1);
    assert.equal(d.breaking[0]!.kind, 'removed');
  });

  it('treats additions as non-breaking', () => {
    const before = snapshotFromConfig(base);
    const after = snapshotFromConfig({
      ...base,
      exports: [
        ...base.exports,
        { name: 'sub', params: ['f64', 'f64'], returns: 'f64' },
      ],
    });
    const d = diffContracts(before, after);
    assert.equal(d.breaking.length, 0);
    assert.equal(d.nonBreaking.length, 1);
  });
});
