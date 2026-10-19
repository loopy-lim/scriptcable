import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLynxEngine } from './index.js';

describe('lynx', () => {
  it('bridge invoke', async () => {
    const engine = createLynxEngine({
      call: (name, args) => (name === 'add' ? Number(args[0]) + Number(args[1]) : null),
    });
    assert.equal(await engine.invoke('add', [2, 3]), 5);
  });
});
