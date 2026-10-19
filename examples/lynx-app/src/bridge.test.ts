import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLynxEngine, lynxScriptcaRsbuildPlugin } from '@scriptca/lynx';
import { ScriptcaRspackPlugin } from '@scriptca/webpack';

describe('lynx example', () => {
  it('engine + plugin shapes', async () => {
    const engine = createLynxEngine({
      call: (n, a) => (n === 'mul' ? Number(a[0]) * Number(a[1]) : 0),
    });
    assert.equal(await engine.invoke('mul', [6, 7]), 42);
    assert.equal(lynxScriptcaRsbuildPlugin({}).name, 'scriptca:lynx-rsbuild');
    assert.equal(typeof ScriptcaRspackPlugin, 'function');
  });
});
