import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { createLynxEngine, lynxScriptcaRsbuildPlugin } from '@scriptcable/lynx';
import { ScriptcaRspackPlugin } from '@scriptcable/webpack';

describe('lynx example', () => {
  it('engine + plugin shapes', async () => {
    const engine = createLynxEngine({
      call: (n, a) => (n === 'mul' ? Number(a[0]) * Number(a[1]) : 0),
    });
    assert.equal(await engine.invoke('mul', [6, 7]), 42);
    assert.equal(lynxScriptcaRsbuildPlugin({}).name, 'scriptcable:lynx-rsbuild');
    assert.equal(typeof ScriptcaRspackPlugin, 'function');
  });
});
