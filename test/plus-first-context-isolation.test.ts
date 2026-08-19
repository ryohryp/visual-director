import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { evaluateNativeImageContext } from '../src/plus-first-context-isolation.js';

const generationReferences = [
  'docs/visual/assets/global_visual_style_reference.webp',
  'public/images/characters/souma/v2/default.avif',
];

describe('Plus-first native image context isolation', () => {
  it('fails closed when unrelated conversation images exist and the host cannot whitelist references', () => {
    expect(evaluateNativeImageContext({
      allowed_reference_paths: generationReferences,
      bound_reference_paths: generationReferences,
      conversation_has_unrelated_images: true,
      host_enforces_reference_whitelist: false,
    })).toEqual(expect.objectContaining({
      allowed: false,
      code: 'UNSAFE_CONVERSATION_IMAGE_CONTEXT',
    }));
  });

  it('rejects a generation parent that is not in the current Generation Package', () => {
    expect(evaluateNativeImageContext({
      allowed_reference_paths: generationReferences,
      bound_reference_paths: [
        ...generationReferences,
        '.visual-director/candidates/dashboard/progress-dashboard.webp',
      ],
      conversation_has_unrelated_images: true,
      host_enforces_reference_whitelist: true,
    })).toEqual(expect.objectContaining({
      allowed: false,
      code: 'REFERENCE_OUTSIDE_GENERATION_PACKAGE',
    }));
  });

  it('allows native generation only when the bound references stay inside the package and isolation is guaranteed', () => {
    expect(evaluateNativeImageContext({
      allowed_reference_paths: generationReferences,
      bound_reference_paths: generationReferences,
      conversation_has_unrelated_images: true,
      host_enforces_reference_whitelist: true,
    })).toEqual({ allowed: true });
  });

  it('stops after two consecutive wrong-reference results instead of blindly regenerating', () => {
    expect(evaluateNativeImageContext({
      allowed_reference_paths: generationReferences,
      bound_reference_paths: generationReferences,
      conversation_has_unrelated_images: false,
      host_enforces_reference_whitelist: true,
      consecutive_reference_mismatches: 2,
    })).toEqual(expect.objectContaining({
      allowed: false,
      code: 'REFERENCE_BINDING_MISMATCH_LIMIT',
    }));
  });

  it('documents the host-level must-not-chain rule and repeated-mismatch stop condition', async () => {
    const docs = await readFile(new URL('../docs/plus-first-image-generation.md', import.meta.url), 'utf8');
    expect(docs).toContain('policy.must_not_chain_from_candidate = true');
    expect(docs).toContain('If the same wrong-reference pattern occurs twice consecutively, stop generation in that context.');
    expect(docs).toContain('A generated dashboard/UI/report must not be extracted, cropped, or re-labelled as a background Candidate');
    expect(docs).toContain('local/tunnel `visual.generate_image`');
  });
});
