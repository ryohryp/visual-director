import { describe, expect, it } from 'vitest';

import { DEFAULT_PROJECT_DOCUMENTS } from '../src/projects/canon/types.js';
import { parseRepositoryCanonManifest } from '../src/projects/canon/repository-manifest.js';

describe('repository-native Canon manifest', () => {
  it('uses stable defaults and loads project-owned subject definitions', () => {
    const definition = parseRepositoryCanonManifest({
      version: 1,
      project_id: 'game-a',
      documents: { globalStyle: 'art/GLOBAL.md' },
      subjects: {
        hero: {
          display_name: 'Hero',
          character_file: 'art/characters/hero.md',
          canon_heading: 'Hero',
        },
      },
    });

    expect(definition.projectId).toBe('game-a');
    expect(definition.documents.globalStyle).toBe('art/GLOBAL.md');
    expect(definition.documents.characterCanon).toBe(DEFAULT_PROJECT_DOCUMENTS.characterCanon);
    expect(definition.subjects.hero).toEqual({
      id: 'hero',
      displayName: 'Hero',
      characterFile: 'art/characters/hero.md',
      canonHeading: 'Hero',
    });
  });

  it('rejects unsupported manifest versions', () => {
    expect(() => parseRepositoryCanonManifest({ version: 2, project_id: 'game-a' }))
      .toThrow('Unsupported Visual Director manifest version: 2.');
  });

  it('rejects unknown document keys instead of silently accepting schema drift', () => {
    expect(() => parseRepositoryCanonManifest({
      version: 1,
      project_id: 'game-a',
      documents: { mystery: 'x.md' },
    })).toThrow('Unknown documents key: mystery.');
  });
});
