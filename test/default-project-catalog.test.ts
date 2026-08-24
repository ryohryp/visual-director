import { describe, expect, it } from 'vitest';

import { createVisualDirectorCore } from '../src/core/visual-director.js';
import type { ProjectVisualOverview } from '../src/domain/types.js';
import { emptyProjectAssetInventory } from '../src/projects/asset-inventory.js';

describe('default Project Catalog selection', () => {
  it('uses projects.catalog.json when no catalog option or environment override is supplied', async () => {
    const previous = process.env.VISUAL_DIRECTOR_PROJECT_CATALOG;
    delete process.env.VISUAL_DIRECTOR_PROJECT_CATALOG;
    try {
      const seen: string[] = [];
      const core = createVisualDirectorCore({
        projectOverviewLoader: async (entry) => {
          seen.push(entry.project_id);
          return emptyOverview(entry.project_id);
        },
      });

      await expect(core.listProjects()).resolves.toEqual([
        expect.objectContaining({
          project_id: 'personal-orbit',
          repository: 'ryohryp/personal-orbit',
        }),
        expect.objectContaining({
          project_id: 'bottom-of-thirst',
          repository: 'ryohryp/---The-Bottom-of-Thirst',
        }),
        expect.objectContaining({
          project_id: 'crownless',
          repository: 'ryohryp/crownless',
        }),
      ]);
      expect(seen).toEqual(['personal-orbit', 'bottom-of-thirst', 'crownless']);
    } finally {
      if (previous === undefined) delete process.env.VISUAL_DIRECTOR_PROJECT_CATALOG;
      else process.env.VISUAL_DIRECTOR_PROJECT_CATALOG = previous;
    }
  });
});

function emptyOverview(projectId: string): ProjectVisualOverview {
  return {
    project_id: projectId,
    visual_direction: {
      grand_design: null,
      global_style: { role: 'global_style' },
    },
    approved_anchors: [],
    workflow: {
      metadata_path: '.visual-director/asset-index.json',
      available: true,
      jobs: [],
      assets: [],
    },
    inventory: emptyProjectAssetInventory(),
  };
}
