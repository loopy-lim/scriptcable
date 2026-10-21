/**
 * Interceptability tests: a bundler plugin may redirect entry imports onto
 * the drop-in client only when the drop-in covers the entry's entire runtime
 * export surface. These tests pin the gap detection.
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeEntryExports } from './infer.js';
import { canInterceptEntry } from './intercept.js';
import type { ResolvedConfig, ScriptcableProfile } from '@scriptcable/types';

describe('analyzeEntryExports', () => {
  it('maps plain function exports', () => {
    const surface = analyzeEntryExports(
      `/** Adds. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n`,
    );
    assert.deepEqual(surface.mapped, ['add']);
    assert.equal(surface.unmapped.length, 0);
  });

  it('flags values, classes, re-exports and default exports as unmapped', () => {
    const surface = analyzeEntryExports(
      `export const VERSION = '1.0.0';\n` +
        `export class Helper {}\n` +
        `export { someHelper } from './util.js';\n` +
        `export default function main(): void {}\n`,
    );
    const names = surface.unmapped.map((u) => u.name);
    assert.ok(names.includes('VERSION'), 'const export must be flagged');
    assert.ok(names.includes('Helper'), 'class export must be flagged');
    assert.ok(names[2]!.includes('someHelper'), 're-export must be flagged');
    assert.ok(names.includes('default'), 'default export must be flagged');
  });

  it('flags functions the ABI inference had to skip', () => {
    const surface = analyzeEntryExports(
      `export function add(a: number, b: number): number { return a + b; }\n` +
        `export function fancy(opts: { a: number }): number { return opts.a; }\n`,
    );
    assert.deepEqual(surface.mapped, ['add']);
    assert.equal(surface.unmapped.length, 1);
    assert.equal(surface.unmapped[0]!.name, 'fancy');
    assert.match(surface.unmapped[0]!.reason, /ABI-mappable/);
  });

  it('ignores type-only exports', () => {
    const surface = analyzeEntryExports(
      `export type UserId = u32;\nexport interface Config { a: number }\n` +
        `export function add(a: u32, b: u32): u32 { return a + b; }\n`,
    );
    assert.deepEqual(surface.mapped, ['add']);
    assert.equal(surface.unmapped.length, 0);
  });

  it('flags enum, namespace, and destructuring exports as unmapped', () => {
    const surface = analyzeEntryExports(
      `export enum Flags { A }\n` +
        `export namespace Util { export const x = 1; }\n` +
        `export const { a, b } = { a: 1, b: 2 };\n` +
        `export function add(x: number, y: number): number { return x + y; }\n`,
    );
    assert.deepEqual(surface.mapped, ['add']);
    const names = surface.unmapped.map((u) => u.name);
    assert.ok(names.includes('Flags'), 'enum must be flagged');
    assert.ok(names.includes('Util'), 'namespace must be flagged');
    assert.ok(names.some((n) => n.includes('a, b')), 'destructuring must be flagged');
  });

  it('flags functions with optional or default parameters', () => {
    const surface = analyzeEntryExports(
      `export function add(a: number, b: number): number { return a + b; }\n` +
        `export function bump(n: number, step = 1): number { return n + step; }\n` +
        `export function pad(n: number, width?: number): number { return width ? n : n; }\n`,
    );
    assert.deepEqual(surface.mapped, ['add']);
    assert.deepEqual(surface.unmapped.map((u) => u.name).sort(), ['bump', 'pad']);
    // `step = 1` carries no annotation — the ABI inference skips it first;
    // the annotated optional `width?` is mapped by inference but blocked here.
    const pad = surface.unmapped.find((u) => u.name === 'pad')!;
    assert.match(pad.reason, /optional\/default parameter/);
  });
});

describe('canInterceptEntry', () => {
  const config = {
    name: 'calc',
    entry: 'src/core.ts',
    prefix: 'calc_',
  } as ResolvedConfig;
  const profile = {
    name: 'calc',
    exports: [{ export: 'add', symbol: 'calc_add', params: ['f64', 'f64'], returns: 'f64' }],
  } as unknown as ScriptcableProfile;

  it('is ok when the drop-in covers the whole surface', async () => {
    const dir = await mkSrc('src', `export function add(a: number, b: number): number {\n  return a + b;\n}\n`);
    const result = await canInterceptEntry(config, dir, profile);
    assert.equal(result.ok, true, result.reasons.join('; '));
  });

  it('disables with reasons when the surface has gaps', async () => {
    const dir = await mkSrc(
      'src',
      `export function add(a: number, b: number): number {\n  return a + b;\n}\n` +
        `export const LIMIT = 10;\n`,
    );
    const result = await canInterceptEntry(config, dir, profile);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => r.includes('LIMIT')), result.reasons.join('; '));
  });

  it('disables when an explicit exports subset omits a mapped export', async () => {
    const dir = await mkSrc(
      'src',
      `export function add(a: number, b: number): number {\n  return a + b;\n}\n` +
        `export function mul(a: number, b: number): number {\n  return a * b;\n}\n`,
    );
    const result = await canInterceptEntry(config, dir, profile);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => r.includes('mul')), result.reasons.join('; '));
  });

  it('disables when the entry is missing', async () => {
    const result = await canInterceptEntry(config, await mkSrc('other', ''), profile);
    assert.equal(result.ok, false);
    assert.ok(result.reasons[0]!.includes('not readable'));
  });
});

async function mkSrc(srcDirName: string, source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-intercept-'));
  await mkdir(join(dir, srcDirName), { recursive: true });
  await writeFile(join(dir, srcDirName, 'core.ts'), source);
  return dir;
}
