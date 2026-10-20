import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { createMockBridge, createReactNativeEngine } from '@scriptcable/react-native';

describe('rn example', () => {
  it('mock bridge', async () => {
    const engine = createReactNativeEngine(
      createMockBridge({
        add: (a, b) => Number(a) + Number(b),
        greet: (name) => `hello, ${name}`,
      }),
    );
    assert.equal(await engine.invoke('add', [1, 2]), 3);
    assert.equal(await engine.invoke('greet', ['rn']), 'hello, rn');
  });
});
