import { describe, expect, it } from 'vitest';

import {
  createGenerationPackageFingerprint,
  type FingerprintableGenerationPackage,
} from '../src/domain/fingerprint.js';

const generationPackage: FingerprintableGenerationPackage = {
  schema_version: 1,
  project_id: 'example-project',
  asset_type: 'event_cg',
  prompt_package: {
    style_lock: 'canonical style',
    subject_lock: ['canonical subject'],
    scene_requirements: ['canonical scene'],
    allowed_changes: ['expression'],
    forbidden_changes: ['identity'],
    avoid_block: ['photorealism'],
  },
  reference_assets: [
    { role: 'global_reference', path: 'docs/visual/global.webp' },
    { role: 'subject_anchor', subject_id: 'hero', path: 'assets/hero/approved.avif' },
  ],
  policy: {
    must_use_approved_anchor: true,
    must_not_chain_from_candidate: true,
    must_review_after_generation: true,
  },
};

describe('Generation Package fingerprint', () => {
  it('is stable for the same package input and is lowercase SHA-256 hex', () => {
    const first = createGenerationPackageFingerprint(generationPackage);
    const second = createGenerationPackageFingerprint(generationPackage);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unchanged when equivalent object keys are inserted in a different order', () => {
    const reordered: FingerprintableGenerationPackage = {
      policy: {
        must_review_after_generation: true,
        must_not_chain_from_candidate: true,
        must_use_approved_anchor: true,
      },
      reference_assets: generationPackage.reference_assets.map((asset) => ({
        path: asset.path,
        ...(asset.subject_id ? { subject_id: asset.subject_id } : {}),
        role: asset.role,
      })),
      prompt_package: {
        avoid_block: ['photorealism'],
        forbidden_changes: ['identity'],
        allowed_changes: ['expression'],
        scene_requirements: ['canonical scene'],
        subject_lock: ['canonical subject'],
        style_lock: 'canonical style',
      },
      asset_type: 'event_cg',
      project_id: 'example-project',
      schema_version: 1,
    };

    expect(createGenerationPackageFingerprint(reordered)).toBe(
      createGenerationPackageFingerprint(generationPackage),
    );
  });

  it('changes when meaningful package content changes', () => {
    const changed: FingerprintableGenerationPackage = {
      ...generationPackage,
      prompt_package: {
        ...generationPackage.prompt_package,
        scene_requirements: ['a different canonical scene'],
      },
    };

    expect(createGenerationPackageFingerprint(changed)).not.toBe(
      createGenerationPackageFingerprint(generationPackage),
    );
  });

  it('excludes an existing fingerprint from the hash input', () => {
    const fingerprint = createGenerationPackageFingerprint(generationPackage);
    const completedPackage = { ...generationPackage, fingerprint };

    expect(createGenerationPackageFingerprint(completedPackage)).toBe(fingerprint);
  });
});
