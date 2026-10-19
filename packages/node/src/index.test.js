import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNodeEngine } from './index.js';
describe('@scriptca/node', () => {
    it('exports createNodeEngine', () => {
        assert.equal(typeof createNodeEngine, 'function');
    });
});
//# sourceMappingURL=index.test.js.map