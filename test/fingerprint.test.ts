import { describe, expect, it } from 'vitest';

import {
  canonicalJsonStringify,
  computeGenerationFingerprint,
  GENERATION_PACKAGE_SCHEMA_VERSION,
} from '../src/domain/fingerprint.js';
import type { GenerationPackage } from '../src/domain/types.js';

const samplePackage: GenerationPackage = {
  schema_version: GENERATION_PACKAGE_SCHEMA_VERSION,
  fingerprint: 'placeholder',
  project_id: 'bottom-of-thirst',
  asset_type: 'event_cg',
  prompt_package: {
    style_lock: 'STYLE LOCK: grounded semi-realistic digital illustration',
    subject_lock: ['相馬 健人 (souma) — Approved Visual Anchor: public/images/characters/souma/v2/default.avif.'],
    scene_requirements: [
      'Asset type: event_cg.',
      'Narrative request: 地下の記録保管庫で古い記録を確認しているイベントCG',
      'Scene context: location: 地下の記録保管庫, story_state: present_day_investigation',
      'World direction: grounded and observational',
    ],
    allowed_changes: ['small facial expression', 'gaze', 'hand position'],
    forbidden_changes: [
      'Do not use legacy, transitional, archived late-state, or exploration-only assets as the generation parent.',
      'face identity',
    ],
    avoid_block: ['photorealism', 'anime'],
  },
  reference_assets: [
    { role: 'global_reference', path: 'docs/visual/assets/global_visual_style_reference.webp' },
    { role: 'subject_anchor', subject_id: 'souma', path: 'public/images/characters/souma/v2/default.avif' },
  ],
  policy: {
    must_use_approved_anchor: true,
    must_not_chain_from_candidate: true,
    must_review_after_generation: true,
  },
};

describe('canonicalJsonStringify', () => {
  it('serializes primitives consistently', () => {
    expect(canonicalJsonStringify('hello')).toBe('"hello"');
    expect(canonicalJsonStringify(42)).toBe('42');
    expect(canonicalJsonStringify(true)).toBe('true');
    expect(canonicalJsonStringify(null)).toBe('null');
  });

  it('sorts object keys alphabetically regardless of insertion order', () => {
    const objA = { z: 1, a: 2, m: 3 };
    const objB = { a: 2, m: 3, z: 1 };
    expect(canonicalJsonStringify(objA)).toBe('{"a":2,"m":3,"z":1}');
    expect(canonicalJsonStringify(objA)).toBe(canonicalJsonStringify(objB));
  });

  it('recursively sorts nested object keys', () => {
    const nestedA = { b: { y: 10, x: 20 }, a: { beta: 2, alpha: 1 } };
    const nestedB = { a: { alpha: 1, beta: 2 }, b: { x: 20, y: 10 } };
    expect(canonicalJsonStringify(nestedA)).toBe('{"a":{"alpha":1,"beta":2},"b":{"x":20,"y":10}}');
    expect(canonicalJsonStringify(nestedA)).toBe(canonicalJsonStringify(nestedB));
  });

  it('preserves array order while canonicalizing object elements', () => {
    const arrayA = [{ b: 1, a: 2 }, { d: 3, c: 4 }];
    const arrayB = [{ a: 2, b: 1 }, { c: 4, d: 3 }];
    expect(canonicalJsonStringify(arrayA)).toBe('[{"a":2,"b":1},{"c":4,"d":3}]');
    expect(canonicalJsonStringify(arrayA)).toBe(canonicalJsonStringify(arrayB));
  });

  it('omits undefined values in objects and serializes undefined in arrays as null', () => {
    expect(canonicalJsonStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJsonStringify([1, undefined, 2])).toBe('[1,null,2]');
  });
});

describe('computeGenerationFingerprint', () => {
  it('returns a valid 64-character lowercase SHA-256 hex string', () => {
    const hash = computeGenerationFingerprint(samplePackage);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable and deterministic across multiple calls with identical data', () => {
    const hash1 = computeGenerationFingerprint(samplePackage);
    const hash2 = computeGenerationFingerprint(samplePackage);
    expect(hash1).toBe(hash2);
  });

  it('produces the identical SHA-256 for objects with different key order', () => {
    const permutedPackage = {
      policy: {
        must_review_after_generation: true as const,
        must_not_chain_from_candidate: true as const,
        must_use_approved_anchor: true,
      },
      reference_assets: [
        { path: 'docs/visual/assets/global_visual_style_reference.webp', role: 'global_reference' as const },
        { subject_id: 'souma', path: 'public/images/characters/souma/v2/default.avif', role: 'subject_anchor' as const },
      ],
      prompt_package: {
        avoid_block: ['photorealism', 'anime'],
        forbidden_changes: [
          'Do not use legacy, transitional, archived late-state, or exploration-only assets as the generation parent.',
          'face identity',
        ],
        allowed_changes: ['small facial expression', 'gaze', 'hand position'],
        scene_requirements: [
          'Asset type: event_cg.',
          'Narrative request: 地下の記録保管庫で古い記録を確認しているイベントCG',
          'Scene context: location: 地下の記録保管庫, story_state: present_day_investigation',
          'World direction: grounded and observational',
        ],
        subject_lock: ['相馬 健人 (souma) — Approved Visual Anchor: public/images/characters/souma/v2/default.avif.'],
        style_lock: 'STYLE LOCK: grounded semi-realistic digital illustration',
      },
      asset_type: 'event_cg',
      project_id: 'bottom-of-thirst',
      schema_version: 1,
    };

    const originalHash = computeGenerationFingerprint(samplePackage);
    const permutedHash = computeGenerationFingerprint(permutedPackage);
    expect(permutedHash).toBe(originalHash);
  });

  it('excludes the fingerprint field itself from the hash calculation', () => {
    const withFingerprintA = { ...samplePackage, fingerprint: 'aaaa1111' };
    const withFingerprintB = { ...samplePackage, fingerprint: 'bbbb2222' };
    const withoutFingerprint = { ...samplePackage };
    delete (withoutFingerprint as Partial<GenerationPackage>).fingerprint;

    const hashA = computeGenerationFingerprint(withFingerprintA);
    const hashB = computeGenerationFingerprint(withFingerprintB);
    const hashNone = computeGenerationFingerprint(withoutFingerprint);

    expect(hashA).toBe(hashB);
    expect(hashA).toBe(hashNone);
  });

  it('changes fingerprint when any meaningful field in the package changes', () => {
    const baseHash = computeGenerationFingerprint(samplePackage);

    // Change project_id
    const diffProject = { ...samplePackage, project_id: 'other-project' };
    expect(computeGenerationFingerprint(diffProject)).not.toBe(baseHash);

    // Change asset_type
    const diffAssetType = { ...samplePackage, asset_type: 'portrait' };
    expect(computeGenerationFingerprint(diffAssetType)).not.toBe(baseHash);

    // Change schema_version
    const diffSchema = { ...samplePackage, schema_version: 2 };
    expect(computeGenerationFingerprint(diffSchema)).not.toBe(baseHash);

    // Change style_lock
    const diffStyle = {
      ...samplePackage,
      prompt_package: { ...samplePackage.prompt_package, style_lock: 'DIFFERENT STYLE' },
    };
    expect(computeGenerationFingerprint(diffStyle)).not.toBe(baseHash);

    // Change scene_requirements
    const diffScene = {
      ...samplePackage,
      prompt_package: {
        ...samplePackage.prompt_package,
        scene_requirements: [...samplePackage.prompt_package.scene_requirements, 'extra requirement'],
      },
    };
    expect(computeGenerationFingerprint(diffScene)).not.toBe(baseHash);

    // Change reference_assets
    const diffRefs = {
      ...samplePackage,
      reference_assets: [samplePackage.reference_assets[0]!],
    };
    expect(computeGenerationFingerprint(diffRefs)).not.toBe(baseHash);

    // Change policy
    const diffPolicy = {
      ...samplePackage,
      policy: { ...samplePackage.policy, must_use_approved_anchor: false },
    };
    expect(computeGenerationFingerprint(diffPolicy)).not.toBe(baseHash);
  });
});
