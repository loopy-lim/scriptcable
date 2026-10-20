import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { createLynxEngine, lynxScriptcableRsbuildPlugin } from '@scriptcable/lynx';
import { ScriptcableRspackPlugin } from '@scriptcable/webpack';

describe('lynx example', () => {
  it('engine + plugin shapes', async () => {
    const engine = createLynxEngine({
      call: (n, a) => (n === 'mul' ? Number(a[0]) * Number(a[1]) : 0),
    });
    assert.equal(await engine.invoke('mul', [6, 7]), 42);
    assert.equal(lynxScriptcableRsbuildPlugin({}).name, 'scriptcable:lynx-rsbuild');
    assert.equal(typeof ScriptcableRspackPlugin, 'function');
  });
});
