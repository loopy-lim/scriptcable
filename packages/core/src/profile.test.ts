/**
 * Explicit `exports` declarations pin the ABI surface but must still carry
 * the source's codegen metadata — generated clients (and drop-ins) keep the
 * original parameter names and JSDoc even when exports are hand-declared.
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProfile } from './profile.js';
import type { ScriptcableConfig } from '@scriptcable/types';

describe('resolveProfile with explicit exports', () => {
  it('merges paramNames and JSDoc from the entry source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sc-profile-explicit-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      join(dir, 'src', 'core.ts'),
      `/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n`,
    );
    const config = {
      name: 'calc',
      entry: 'src/core.ts',
      prefix: 'calc_',
      exports: [{ name: 'add', params: ['f64', 'f64'], returns: 'f64' }],
    } as ScriptcableConfig;

    const { profile, inferred } = await resolveProfile(config, dir);
    assert.equal(inferred, false, 'explicit declarations must still report as declared');
    assert.equal(profile.exports.length, 1);
    assert.deepEqual(profile.exports[0]!.paramNames, ['a', 'b']);
    assert.equal(profile.exports[0]!.doc, 'Adds two numbers.');
  });

  it('survives a missing entry source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sc-profile-explicit-'));
    const config = {
      name: 'calc',
      entry: 'src/missing.ts',
      prefix: 'calc_',
      exports: [{ name: 'add', params: ['f64', 'f64'], returns: 'f64' }],
    } as ScriptcableConfig;
    const { profile } = await resolveProfile(config, dir);
    assert.equal(profile.exports.length, 1);
    assert.equal(profile.exports[0]!.paramNames, undefined, 'positional fallback');
  });
});
