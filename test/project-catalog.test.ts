import { describe, expect, it } from 'vitest';

import { createVisualDirectorCore } from '../src/core/visual-director.js';
import type { ProjectVisualOverview } from '../src/domain/types.js';
import { loadProjectCatalog, parseProjectCatalog } from '../src/projects/catalog.js';

const rawCatalog = {
  projects: [
    {
      project_id: 'bottom-of-thirst',
      display_name: 'The Bottom of Thirst',
      repository: 'ryohryp/---The-Bottom-of-Thirst',
      ref: 'main',
      adapter_type: 'generic',
    },
    {
      project_id: 'game-b',
      display_name: 'Game B',
      repository: 'ryohryp/game-b',
      ref: 'release',
      adapter_type: 'generic',
    },
  ],
};

describe('Project Catalog', () => {
  it('ships the required repository defaults for the hosted workspace', () => {
    const catalog = loadProjectCatalog('projects.catalog.json');

    expect(catalog.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        project_id: 'personal-orbit',
        display_name: 'Personal Orbit',
        repository: { owner: 'ryohryp', name: 'personal-orbit' },
        ref: 'main',
        adapter_type: 'personal-orbit',
      }),
      expect.objectContaining({
        project_id: 'bottom-of-thirst',
        display_name: 'The Bottom of Thirst',
        repository: { owner: 'ryohryp', name: '---The-Bottom-of-Thirst' },
        ref: 'main',
        adapter_type: 'generic',
      }),
      expect.objectContaining({
        project_id: 'crownless',
        display_name: 'Crownless',
        repository: { owner: 'ryohryp', name: 'crownless' },
        ref: 'main',
        adapter_type: 'generic',
      }),
    ]));
  });

  it('accepts the Personal Orbit hosted adapter type', () => {
    const catalog = parseProjectCatalog({
      projects: [{
        project_id: 'personal-orbit',
        display_name: 'Personal Orbit',
        repository: 'ryohryp/personal-orbit',
        ref: 'main',
        adapter_type: 'personal-orbit',
      }],
    });

    expect(catalog.resolve('personal-orbit')).toMatchObject({ adapter_type: 'personal-orbit' });
  });

  it('loads two projects and resolves each id to exactly one repository/ref/adapter', () => {
    const catalog = parseProjectCatalog(rawCatalog);

    expect(catalog.list()).toHaveLength(2);
    expect(catalog.resolve('bottom-of-thirst')).toMatchObject({
      repository: { owner: 'ryohryp', name: '---The-Bottom-of-Thirst' },
      ref: 'main',
      adapter_type: 'generic',
    });
    expect(catalog.resolve('game-b')).toMatchObject({
      repository: { owner: 'ryohryp', name: 'game-b' },
      ref: 'release',
      adapter_type: 'generic',
    });
  });

  it('fails closed for duplicate, invalid, legacy adapter, and unknown project ids', () => {
    expect(() => parseProjectCatalog({ projects: [rawCatalog.projects[0], rawCatalog.projects[0]] }))
      .toThrowError(expect.objectContaining({ code: 'PROJECT_CATALOG_DUPLICATE' }));
    expect(() => parseProjectCatalog({
      projects: [{ ...rawCatalog.projects[0], project_id: '../escape' }],
    })).toThrowError(expect.objectContaining({ code: 'PROJECT_CATALOG_INVALID' }));
    expect(() => parseProjectCatalog({
      projects: [{ ...rawCatalog.projects[0], adapter_type: 'bottom-of-thirst' }],
    })).toThrowError(expect.objectContaining({ code: 'PROJECT_CATALOG_INVALID' }));

    const catalog = parseProjectCatalog(rawCatalog);
    expect(() => catalog.resolve('missing')).toThrowError(expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }));
  });

  it('derives each project summary from that project repository overview', async () => {
    const catalog = parseProjectCatalog(rawCatalog);
    const seenRepositories: string[] = [];
    const core = createVisualDirectorCore({
      projectCatalog: catalog,
      projectOverviewLoader: async (entry) => {
        seenRepositories.push(`${entry.repository.owner}/${entry.repository.name}@${entry.ref}`);
        return entry.project_id === 'bottom-of-thirst'
          ? overview('bottom-of-thirst', 2, 3, 1, 1, 'docs/visual/grand.webp')
          : overview('game-b', 1, 5, 2, 2, 'docs/visual/style.webp');
      },
    });

    await expect(core.listProjects()).resolves.toEqual([
      expect.objectContaining({
        project_id: 'bottom-of-thirst',
        repository: 'ryohryp/---The-Bottom-of-Thirst',
        anchors: 2,
        candidates: 1,
        jobs: 3,
        failed_jobs: 1,
        thumbnail: 'docs/visual/grand.webp',
      }),
      expect.objectContaining({
        project_id: 'game-b',
        repository: 'ryohryp/game-b',
        anchors: 1,
        candidates: 2,
        jobs: 5,
        failed_jobs: 2,
        thumbnail: 'docs/visual/style.webp',
      }),
    ]);
    expect(seenRepositories).toEqual([
      'ryohryp/---The-Bottom-of-Thirst@main',
      'ryohryp/game-b@release',
    ]);
  });

  it('rejects an overview returned for another project instead of cross-project fallback', async () => {
    const core = createVisualDirectorCore({
      projectCatalog: parseProjectCatalog({ projects: [rawCatalog.projects[1]] }),
      projectOverviewLoader: async () => overview('bottom-of-thirst', 0, 0, 0, 0, null),
    });

    await expect(core.listProjects()).rejects.toMatchObject({ code: 'PROJECT_SUMMARY_MISMATCH' });
  });
});

function overview(
  projectId: string,
  anchorCount: number,
  jobCount: number,
  candidateCount: number,
  failedCount: number,
  thumbnail: string | null,
): ProjectVisualOverview {
  return {
    project_id: projectId,
    visual_direction: {
      grand_design: thumbnail?.includes('grand') ? { role: 'grand_design', asset_path: thumbnail } : null,
      global_style: {
        role: 'global_style',
        ...(thumbnail && !thumbnail.includes('grand') ? { asset_path: thumbnail } : {}),
      },
    },
    approved_anchors: Array.from({ length: anchorCount }, (_, index) => ({
      subject_id: `subject-${index}`,
      display_name: `Subject ${index}`,
      asset_type: 'character_visual_anchor' as const,
      path: `anchors/${index}.webp`,
      status: 'approved' as const,
    })),
    workflow: {
      metadata_path: '.visual-director/asset-index.json',
      available: true,
      jobs: Array.from({ length: jobCount }, (_, index) => ({
        job_id: `job-${index}`,
        asset_type: 'scene',
        subject_ids: ['subject-0'],
        request_text: 'generate',
        status: index < failedCount ? 'failed' as const : 'registered' as const,
      })),
      assets: Array.from({ length: candidateCount }, (_, index) => ({
        asset_id: `asset-${index}`,
        asset_type: 'scene',
        status: 'candidate' as const,
        reference_paths: [],
      })),
    },
  };
}
