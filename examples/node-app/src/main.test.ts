import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createNodeEngineFromOutDir } from '@scriptca/node';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { access } from 'node:fs/promises';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../calculator-core/.scriptca');

describe('node e2e', () => {
  before(async () => {
    await access(join(outDir, 'calculator.wasm'));
  });

  it('add/mul/greet', async () => {
    const engine = await createNodeEngineFromOutDir(outDir);
    assert.equal(engine.call('add', 20, 22), 42);
    assert.equal(engine.call('mul', 6, 7), 42);
    assert.equal(engine.call('greet', 'test'), 'hello, test');
    engine.dispose?.();
  });
});
