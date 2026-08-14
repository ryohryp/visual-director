import { describe, expect, it } from 'vitest';

import { computeFingerprint } from '../src/domain/fingerprint.js';

describe('computeFingerprint', () => {
  it('is stable for the same input', () => {
    const value = { prompt_package: { style_lock: 'locked', subject_lock: ['souma'] }, project_id: 'bottom-of-thirst' };

    expect(computeFingerprint(value)).toBe(computeFingerprint(value));
  });

  it('does not change when only object key order changes', () => {
    const first = { project_id: 'bottom-of-thirst', policy: { review: true, anchor: true } };
    const second = { policy: { anchor: true, review: true }, project_id: 'bottom-of-thirst' };

    expect(computeFingerprint(first)).toBe(computeFingerprint(second));
  });

  it('changes when package meaning changes', () => {
    expect(computeFingerprint({ request: 'night scene' })).not.toBe(computeFingerprint({ request: 'day scene' }));
  });

  it('returns a lowercase 64-character hex digest', () => {
    expect(computeFingerprint({ package: 'value' })).toMatch(/^[0-9a-f]{64}$/);
  });
});
