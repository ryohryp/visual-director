import { describe, expect, it } from 'vitest';

import { parseGrandDesign, resolveGrandDesignContract } from '../src/projects/canon/grand-design.js';

function raw(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema_version: 1,
    project_id: 'game-a',
    visual_dna: 'ordinary first',
    shared_rules: { low_saturation: true },
    fixed_avoid: ['generic horror'],
    asset_types: {
      background: { purpose: 'observation base', forbidden: ['gratuitous fog'] },
      ui: { purpose: 'trusted record', forbidden: ['constant glitch'] },
    },
    ...overrides,
  });
}

describe('Grand Design', () => {
  it('validates v1 and resolves only the requested asset contract', () => {
    const document = parseGrandDesign(raw(), 'game-a', '.visual-director/grand-design.json');
    const contract = resolveGrandDesignContract(document, 'background');

    expect(contract).toEqual({
      schema_version: 1,
      visual_dna: 'ordinary first',
      shared_rules: { low_saturation: true },
      fixed_avoid: ['generic horror'],
      asset_type: 'background',
      asset_contract: { purpose: 'observation base', forbidden: ['gratuitous fog'] },
    });
    expect(JSON.stringify(contract)).not.toContain('constant glitch');
  });

  it('keeps undefined asset types backward compatible', () => {
    const document = parseGrandDesign(raw(), 'game-a', '.visual-director/grand-design.json');
    expect(resolveGrandDesignContract(document, 'character_visual_anchor')).toBeUndefined();
  });

  it('fails closed for malformed JSON', () => {
    expect(() => parseGrandDesign('{', 'game-a', 'grand-design.json')).toThrowError(expect.objectContaining({ code: 'GRAND_DESIGN_INVALID' }));
  });

  it('fails closed for unknown schema versions', () => {
    expect(() => parseGrandDesign(raw({ schema_version: 2 }), 'game-a', 'grand-design.json')).toThrowError(expect.objectContaining({ code: 'GRAND_DESIGN_VERSION_UNSUPPORTED' }));
  });

  it('fails closed for project mismatch', () => {
    expect(() => parseGrandDesign(raw({ project_id: 'other' }), 'game-a', 'grand-design.json')).toThrowError(expect.objectContaining({ code: 'GRAND_DESIGN_PROJECT_MISMATCH' }));
  });

  it('fails closed for invalid field types', () => {
    expect(() => parseGrandDesign(raw({ fixed_avoid: 'nope' }), 'game-a', 'grand-design.json')).toThrowError(expect.objectContaining({ code: 'GRAND_DESIGN_INVALID' }));
  });
});
