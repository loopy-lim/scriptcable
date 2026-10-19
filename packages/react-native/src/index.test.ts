import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockBridge, createReactNativeEngine } from './index.js';

describe('react-native', () => {
  it('mock bridge works', async () => {
    const engine = createReactNativeEngine(
      createMockBridge({ add: (a, b) => Number(a) + Number(b) }),
    );
    assert.equal(await engine.invoke('add', [20, 22]), 42);
  });
});
