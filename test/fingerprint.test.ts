import { describe, expect, it } from 'vitest';

import { computeFingerprint } from '../src/domain/fingerprint.js';

describe('computeFingerprint', () => {
  it('is stable for the same input across repeated calls', () => {
    const value = { b: 1, a: { z: 2, y: [1, 2, 3] } };

    const first = computeFingerprint(value);
    const second = computeFingerprint(value);

    expect(first).toBe(second);
  });

  it('is unaffected by object key ordering, including nested keys', () => {
    const original = { project_id: 'p', prompt_package: { style_lock: 's', subject_lock: ['a', 'b'] }, policy: { a: true, b: false } };
    const reordered = { policy: { b: false, a: true }, prompt_package: { subject_lock: ['a', 'b'], style_lock: 's' }, project_id: 'p' };

    expect(computeFingerprint(reordered)).toBe(computeFingerprint(original));
  });

  it('preserves array order as meaningful, unlike object key order', () => {
    const value = { list: [1, 2, 3] };
    const reversed = { list: [3, 2, 1] };

    expect(computeFingerprint(reversed)).not.toBe(computeFingerprint(value));
  });

  it('changes when meaningful content changes', () => {
    const before = { project_id: 'p', request_text: 'A quiet portrait.' };
    const after = { project_id: 'p', request_text: 'A quiet portrait, at dawn.' };

    expect(computeFingerprint(after)).not.toBe(computeFingerprint(before));
  });

  it('produces a lowercase 64-character hex SHA-256 digest', () => {
    const fingerprint = computeFingerprint({ any: 'value' });

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
