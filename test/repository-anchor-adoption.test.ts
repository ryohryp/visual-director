import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { adoptRepositoryAnchor } from '../src/repository-anchor-adoption.js';

const adopted = {
  project_id: 'bottom-of-thirst',
  subject_id: 'kamino_kyosuke',
  status: 'approved' as const,
  anchor_path: 'public/images/characters/kamino_kyosuke/v2/default.webp',
  approved_anchor_path: 'public/images/characters/kamino_kyosuke/v2/default.webp',
  canon_path: 'docs/visual/CHARACTER_VISUAL_CANON.md',
  changed: true,
  sha256: 'a'.repeat(64),
  mime_type: 'image/webp',
  width: 1024,
  height: 1536,
};

describe('repository-native anchor adoption', () => {
  it('requires explicit repository binding, adopts through Core, then refreshes compiled Canon', async () => {
    const configureProject = vi.fn().mockResolvedValue({
      project_id: 'bottom-of-thirst',
      repository_path: '/repo',
      persistence: 'runtime',
    });
    const adoptAnchor = vi.fn().mockResolvedValue(adopted);
    const createCore = vi.fn().mockReturnValue({ configureProject, adoptAnchor });
    const compileCanon = vi.fn().mockResolvedValue({});

    const result = await adoptRepositoryAnchor({
      projectId: 'bottom-of-thirst',
      repositoryPath: '/repo',
      subjectId: 'kamino_kyosuke',
      candidatePath: '.visual-director/candidates/job-1/kamino.webp',
    }, {
      createCore: createCore as never,
      compileCanon: compileCanon as never,
    });

    expect(createCore).toHaveBeenCalledWith({});
    expect(configureProject).toHaveBeenCalledWith('bottom-of-thirst', path.resolve('/repo'));
    expect(adoptAnchor).toHaveBeenCalledWith({
      project_id: 'bottom-of-thirst',
      subject_id: 'kamino_kyosuke',
      candidate_path: '.visual-director/candidates/job-1/kamino.webp',
      approval: 'approve',
    });
    expect(compileCanon).toHaveBeenCalledWith({
      projectId: 'bottom-of-thirst',
      repositoryPath: path.resolve('/repo'),
    });
    expect(result).toEqual({
      ...adopted,
      compiled_canon_path: '.visual-director/compiled-canon.json',
    });
  });

  it('passes an explicit projects config to the Core for configured repository projects', async () => {
    const configureProject = vi.fn().mockResolvedValue({});
    const adoptAnchor = vi.fn().mockResolvedValue(adopted);
    const createCore = vi.fn().mockReturnValue({ configureProject, adoptAnchor });
    const compileCanon = vi.fn().mockResolvedValue({});

    await adoptRepositoryAnchor({
      projectId: 'custom-game',
      repositoryPath: '/repo',
      subjectId: 'hero',
      candidatePath: 'assets/hero.webp',
      projectsConfigPath: '/config/projects.json',
    }, {
      createCore: createCore as never,
      compileCanon: compileCanon as never,
    });

    expect(createCore).toHaveBeenCalledWith({ projectsConfigPath: '/config/projects.json' });
  });
});
