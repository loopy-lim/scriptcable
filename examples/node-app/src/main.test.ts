import { describe, it, beforeAll } from 'bun:test';
import assert from 'node:assert/strict';
import { createNodeEngineFromOutDir } from '@scriptcable/node';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { access } from 'node:fs/promises';
import { sharedLibraryFileName } from '@scriptcable/core';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../calculator-core/.scriptcable');

describe('node e2e', () => {
  beforeAll(async () => {
    await access(join(outDir, sharedLibraryFileName('calculator')));
  });

  it('add/mul/greet', async () => {
    const engine = await createNodeEngineFromOutDir(outDir);
    assert.equal(engine.call('add', 20, 22), 42);
    assert.equal(engine.call('mul', 6, 7), 42);
    assert.equal(engine.call('greet', 'test'), 'hello, test');
    engine.dispose?.();
  });
});
