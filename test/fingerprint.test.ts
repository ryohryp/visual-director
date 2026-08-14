import { describe, expect, it } from 'vitest';

import { canonicalStringify, computeFingerprint } from '../src/domain/fingerprint.js';

describe('computeFingerprint', () => {
  it('is stable for the same semantic content', () => {
    const value = { b: 2, a: 1, nested: { y: 'two', x: 'one' } };
    expect(computeFingerprint(value)).toBe(computeFingerprint({ b: 2, a: 1, nested: { y: 'two', x: 'one' } }));
  });

  it('is unaffected by object key order at any depth', () => {
    const first = { a: 1, b: { c: 2, d: [{ e: 3, f: 4 }] } };
    const second = { b: { d: [{ f: 4, e: 3 }], c: 2 }, a: 1 };
    expect(computeFingerprint(first)).toBe(computeFingerprint(second));
  });

  it('changes when semantic content changes', () => {
    const before = { request: 'hello', settings: { style: 'a' } };
    const after = { request: 'hello', settings: { style: 'b' } };
    expect(computeFingerprint(before)).not.toBe(computeFingerprint(after));
  });

  it('produces a lowercase 64-character hex SHA-256 digest', () => {
    expect(computeFingerprint({ any: 'value' })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not sort array element order, only object keys', () => {
    const value = { list: ['b', 'a'] };
    expect(canonicalStringify(value)).toBe('{"list":["b","a"]}');
  });
});
