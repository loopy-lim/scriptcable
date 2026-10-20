import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { createTauriSidecarEngine } from './index.js';
import type { ScriptcaProfile } from '@scriptcable/types';

const profile: ScriptcaProfile = {
  profile_format: 1,
  name: 'calc',
  entry: 'core.ts',
  emission: 'llvm',
  abi: { prefix: 'calc_', init_symbol: 'calc_init', sink_register_symbol: 'calc_sink' },
  exports: [{ export: 'add', symbol: 'calc_add', params: ['f64', 'f64'], returns: 'f64' }],
};

describe('tauri sidecar', () => {
  it('routes invoke', async () => {
    const calls: unknown[] = [];
    const engine = createTauriSidecarEngine({
      profile,
      invoke: async (cmd, args) => {
        calls.push([cmd, args]);
        return 42;
      },
    });
    assert.equal(await engine.invoke('add', [20, 22]), 42);
    assert.deepEqual(calls[0], ['scriptcable_add', { args: [20, 22] }]);
  });
});
