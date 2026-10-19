import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockBridge, createReactNativeEngine } from '@scriptca/react-native';

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
