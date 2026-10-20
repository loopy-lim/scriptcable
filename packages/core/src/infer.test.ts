import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { inferExportsFromSource } from './infer.js';

describe('inferExportsFromSource', () => {
  it('infers primitive functions with param names and docs', () => {
    const src = `
/** Adds two numbers. */
export function add(a: number, b: number): number {
  return a + b;
}

/** Greets a user. */
export function greet(name: string): string {
  return \`hello, \${name}\`;
}

export function ping(): void {}
`;
    const { exports, skipped } = inferExportsFromSource(src);
    assert.equal(skipped.length, 0);
    assert.equal(exports.length, 3);

    const add = exports.find((e) => e.name === 'add')!;
    assert.deepEqual(add.params, ['f64', 'f64']);
    assert.deepEqual(add.paramNames, ['a', 'b']);
    assert.equal(add.returns, 'f64');
    assert.equal(add.doc, 'Adds two numbers.');

    const greet = exports.find((e) => e.name === 'greet')!;
    assert.deepEqual(greet.params, ['string']);
    assert.deepEqual(greet.paramNames, ['name']);
    assert.equal(greet.returns, 'string');

    const ping = exports.find((e) => e.name === 'ping')!;
    assert.equal(ping.returns, 'void');
  });

  it('resolves ABI alias type declarations (u32, i64, bytes)', () => {
    const src = `
type UserId = u32;
type Timestamp = i64;
type Blob = bytes;

export function lookup(id: UserId, at: Timestamp): string {
  return \`\${id}@\${at}\`;
}

export function hash(data: Blob): Blob {
  return data;
}
`;
    const { exports, skipped } = inferExportsFromSource(src);
    assert.equal(skipped.length, 0);
    const lookup = exports.find((e) => e.name === 'lookup')!;
    assert.deepEqual(lookup.params, ['u32', 'i64']);
    assert.equal(lookup.returns, 'string');

    const hash = exports.find((e) => e.name === 'hash')!;
    assert.deepEqual(hash.params, ['bytes']);
    assert.equal(hash.returns, 'bytes');
  });

  it('skips unmappable exports with a reason', () => {
    const src = `
export function bad(x: { a: number }): number { return x.a; }
export function untyped(x) { return x; }
export function good(x: number): number { return x; }
`;
    const { exports, skipped } = inferExportsFromSource(src);
    assert.equal(exports.length, 1);
    assert.equal(exports[0]!.name, 'good');
    assert.equal(skipped.length, 2);
    assert.ok(skipped.find((s) => s.name === 'bad')!.reason.includes('not ABI-mappable'));
    assert.ok(skipped.find((s) => s.name === 'untyped')!.reason.includes('no type annotation'));
  });

  it('ignores non-exported functions', () => {
    const src = `
function helper(a: number): number { return a; }
export const notFn = 42;
export function ok(a: number): number { return a; }
`;
    const { exports } = inferExportsFromSource(src);
    assert.equal(exports.length, 1);
    assert.equal(exports[0]!.name, 'ok');
  });

  it('maps boolean and Uint8Array', () => {
    const src = `
export function flag(on: boolean): boolean { return !on; }
export function digest(data: Uint8Array): Uint8Array { return data; }
`;
    const { exports, skipped } = inferExportsFromSource(src);
    assert.equal(skipped.length, 0);
    assert.deepEqual(exports.find((e) => e.name === 'flag')!.params, ['bool']);
    assert.deepEqual(exports.find((e) => e.name === 'digest')!.params, ['bytes']);
  });
});
