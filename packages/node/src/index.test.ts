import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { createNodeEngine } from './index.js';

describe('@scriptcable/node', () => {
  it('exports createNodeEngine', () => {
    assert.equal(typeof createNodeEngine, 'function');
  });
});
