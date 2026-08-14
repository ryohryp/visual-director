import { describe, expect, it } from 'vitest';

import { canonicalJson, computeGenerationPackageFingerprint } from '../src/domain/fingerprint.js';
import type { GenerationPackage } from '../src/domain/types.js';

const samplePackage: GenerationPackage = {
  schema_version: 1,
  fingerprint: '',
  project_id: 'bottom-of-thirst',
  asset_type: 'event_cg',
  prompt_package: {
    style_lock: 'STYLE LOCK: grounded semi-realistic digital illustration',
    subject_lock: ['相馬 健人 (souma) — Approved Visual Anchor: public/images/characters/souma/v2/default.avif.'],
    scene_requirements: [
      'Asset type: event_cg.',
      'Narrative request: 地下の記録保管庫で古い記録を確認しているイベントCG',
      'Scene context: location: 地下の記録保管庫',
      'World direction: grounded and observational',
    ],
    allowed_changes: ['small facial expression', 'gaze', 'hand position'],
    forbidden_changes: ['Do not change face identity.'],
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

describe('canonicalJson', () => {
  it('serializes objects deterministically regardless of key order', () => {
    const objA = { b: 2, a: 1, nested: { y: 'world', x: 'hello' } };
    const objB = { a: 1, nested: { x: 'hello', y: 'world' }, b: 2 };
    expect(canonicalJson(objA)).toBe(canonicalJson(objB));
    expect(canonicalJson(objA)).toBe('{"a":1,"b":2,"nested":{"x":"hello","y":"world"}}');
  });

  it('excludes the fingerprint property from serialization', () => {
    const withFingerprint = { ...samplePackage, fingerprint: 'some-existing-hash' };
    const withoutFingerprint = { ...samplePackage, fingerprint: '' };
    expect(canonicalJson(withFingerprint)).toBe(canonicalJson(withoutFingerprint));
    expect(canonicalJson(withFingerprint)).not.toContain('fingerprint');
  });
});

describe('computeGenerationPackageFingerprint', () => {
  it('computes a 64-character lowercase hex SHA-256 string', () => {
    const fingerprint = computeGenerationPackageFingerprint(samplePackage);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces identical fingerprint for identical inputs across multiple runs', () => {
    const hash1 = computeGenerationPackageFingerprint(samplePackage);
    const hash2 = computeGenerationPackageFingerprint(JSON.parse(JSON.stringify(samplePackage)));
    expect(hash1).toBe(hash2);
  });

  it('produces identical fingerprint when object keys are reordered', () => {
    const reordered: GenerationPackage = {
      policy: {
        must_review_after_generation: true,
        must_not_chain_from_candidate: true,
        must_use_approved_anchor: true,
      },
      reference_assets: [
        { path: 'docs/visual/assets/global_visual_style_reference.webp', role: 'global_reference' },
        { subject_id: 'souma', role: 'subject_anchor', path: 'public/images/characters/souma/v2/default.avif' },
      ],
      prompt_package: {
        avoid_block: ['photorealism', 'anime'],
        forbidden_changes: ['Do not change face identity.'],
        allowed_changes: ['small facial expression', 'gaze', 'hand position'],
        scene_requirements: [
          'Asset type: event_cg.',
          'Narrative request: 地下の記録保管庫で古い記録を確認しているイベントCG',
          'Scene context: location: 地下の記録保管庫',
          'World direction: grounded and observational',
        ],
        subject_lock: ['相馬 健人 (souma) — Approved Visual Anchor: public/images/characters/souma/v2/default.avif.'],
        style_lock: 'STYLE LOCK: grounded semi-realistic digital illustration',
      },
      asset_type: 'event_cg',
      project_id: 'bottom-of-thirst',
      fingerprint: 'random-ignored',
      schema_version: 1,
    };

    expect(computeGenerationPackageFingerprint(reordered)).toBe(
      computeGenerationPackageFingerprint(samplePackage),
    );
  });

  it('changes fingerprint when schema_version changes', () => {
    const modified = { ...samplePackage, schema_version: 2 };
    expect(computeGenerationPackageFingerprint(modified)).not.toBe(
      computeGenerationPackageFingerprint(samplePackage),
    );
  });

  it('changes fingerprint when project_id or asset_type changes', () => {
    const modProject = { ...samplePackage, project_id: 'other-project' };
    const modAsset = { ...samplePackage, asset_type: 'character_portrait' };
    expect(computeGenerationPackageFingerprint(modProject)).not.toBe(
      computeGenerationPackageFingerprint(samplePackage),
    );
    expect(computeGenerationPackageFingerprint(modAsset)).not.toBe(
      computeGenerationPackageFingerprint(samplePackage),
    );
  });

  it('changes fingerprint when any prompt_package field changes', () => {
    const baseHash = computeGenerationPackageFingerprint(samplePackage);

    const modStyle = {
      ...samplePackage,
      prompt_package: { ...samplePackage.prompt_package, style_lock: 'NEW STYLE' },
    };
    expect(computeGenerationPackageFingerprint(modStyle)).not.toBe(baseHash);

    const modSubject = {
      ...samplePackage,
      prompt_package: { ...samplePackage.prompt_package, subject_lock: ['Different subject lock'] },
    };
    expect(computeGenerationPackageFingerprint(modSubject)).not.toBe(baseHash);

    const modScene = {
      ...samplePackage,
      prompt_package: { ...samplePackage.prompt_package, scene_requirements: ['Different req'] },
    };
    expect(computeGenerationPackageFingerprint(modScene)).not.toBe(baseHash);

    const modAllowed = {
      ...samplePackage,
      prompt_package: { ...samplePackage.prompt_package, allowed_changes: [] },
    };
    expect(computeGenerationPackageFingerprint(modAllowed)).not.toBe(baseHash);

    const modForbidden = {
      ...samplePackage,
      prompt_package: { ...samplePackage.prompt_package, forbidden_changes: [] },
    };
    expect(computeGenerationPackageFingerprint(modForbidden)).not.toBe(baseHash);

    const modAvoid = {
      ...samplePackage,
      prompt_package: { ...samplePackage.prompt_package, avoid_block: ['different'] },
    };
    expect(computeGenerationPackageFingerprint(modAvoid)).not.toBe(baseHash);
  });

  it('changes fingerprint when reference_assets changes', () => {
    const baseHash = computeGenerationPackageFingerprint(samplePackage);
    const modRef = {
      ...samplePackage,
      reference_assets: [samplePackage.reference_assets[0]],
    };
    expect(computeGenerationPackageFingerprint(modRef)).not.toBe(baseHash);
  });

  it('changes fingerprint when policy changes', () => {
    const baseHash = computeGenerationPackageFingerprint(samplePackage);
    const modPolicy = {
      ...samplePackage,
      policy: { ...samplePackage.policy, must_use_approved_anchor: false },
    };
    expect(computeGenerationPackageFingerprint(modPolicy)).not.toBe(baseHash);
  });
});
