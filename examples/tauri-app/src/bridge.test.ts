import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { createTauriSidecarEngine } from '@scriptcable/tauri';
import type { ScriptcableProfile } from '@scriptcable/types';

const profile: ScriptcableProfile = {
  profile_format: 1,
  name: 'calculator',
  entry: 'core.ts',
  emission: 'llvm',
  abi: { prefix: 'calc_', init_symbol: 'calc_init', sink_register_symbol: 'calc_sink' },
  exports: [
    { export: 'add', symbol: 'calc_add', params: ['f64', 'f64'], returns: 'f64' },
  ],
};

describe('tauri example', () => {
  it('sidecar bridge', async () => {
    const engine = createTauriSidecarEngine({
      profile,
      invoke: async (_cmd, args) => {
        const a = (args as { args: number[] }).args;
        return a[0]! + a[1]!;
      },
    });
    assert.equal(await engine.invoke('add', [20, 22]), 42);
  });
});
