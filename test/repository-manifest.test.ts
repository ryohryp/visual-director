import { describe, expect, it } from 'vitest';

import { DEFAULT_PROJECT_DOCUMENTS } from '../src/projects/canon/types.js';
import { parseRepositoryCanonManifest } from '../src/projects/canon/repository-manifest.js';

describe('repository-native Canon manifest', () => {
  it('uses stable defaults and loads project-owned subject definitions', () => {
    const definition = parseRepositoryCanonManifest({
      version: 1,
      project_id: 'game-a',
      documents: { grandDesign: 'art/GRAND_DESIGN.md', globalStyle: 'art/GLOBAL.md' },
      subjects: { hero: { display_name: 'Hero', character_file: 'art/characters/hero.md', canon_heading: 'Hero', aliases: ['protagonist', '主人公'], anchor_requirements_file: 'art/characters/HERO_ANCHOR.md', required_new_anchor_terms: ['24歳', '配信者'] } },
    });

    expect(definition.projectId).toBe('game-a');
    expect(definition.documents.grandDesign).toBe('art/GRAND_DESIGN.md');
    expect(definition.documents.globalStyle).toBe('art/GLOBAL.md');
    expect(definition.documents.characterCanon).toBe(DEFAULT_PROJECT_DOCUMENTS.characterCanon);
    expect(definition.subjects.hero).toEqual({ id: 'hero', displayName: 'Hero', characterFile: 'art/characters/hero.md', canonHeading: 'Hero', aliases: ['protagonist', '主人公'], anchorRequirementsFile: 'art/characters/HERO_ANCHOR.md', requiredNewAnchorTerms: ['24歳', '配信者'] });
  });

  it('does not invent a grand design when the manifest omits it', () => {
    const definition = parseRepositoryCanonManifest({ version: 1, project_id: 'game-a' });
    expect(definition.documents.grandDesign).toBeUndefined();
  });

  it('rejects unsupported manifest versions', () => {
    expect(() => parseRepositoryCanonManifest({ version: 2, project_id: 'game-a' })).toThrow('Unsupported Visual Director manifest version: 2.');
  });

  it('rejects unknown document keys instead of silently accepting schema drift', () => {
    expect(() => parseRepositoryCanonManifest({ version: 1, project_id: 'game-a', documents: { mystery: 'x.md' } })).toThrow('Unknown documents key: mystery.');
  });

  it('rejects ambiguous subject aliases after normalization', () => {
    expect(() => parseRepositoryCanonManifest({ version: 1, project_id: 'game-a', subjects: {
      hero: { display_name: 'Hero', character_file: 'hero.md', canon_heading: 'Hero', aliases: ['Main Character'] },
      rival: { display_name: 'Rival', character_file: 'rival.md', canon_heading: 'Rival', aliases: ['main-character'] },
    } })).toThrow('Subject alias main-character is ambiguous between hero and rival.');
  });
});
