import { describe, expect, it } from 'vitest';

import type { ProjectVisualOverview } from '../src/domain/types.js';
import { diagnoseProjectRepository } from '../src/projects/diagnostics.js';
import type { RepositorySource } from '../src/projects/repository-source.js';

const entry = {
  project_id: 'game-b',
  display_name: 'Game B',
  repository: { owner: 'ryohryp', name: 'game-b' },
  ref: 'main',
  adapter_type: 'generic' as const,
};

const files = new Set([
  'docs/visual/GLOBAL_VISUAL_STYLE.md',
  'docs/visual/CHARACTER_VISUAL_CANON.md',
  'docs/WORLD_DIRECTION.md',
  'docs/visual/assets/README.md',
  'docs/visual/assets/global_visual_style_reference.webp',
]);

class FakeSource implements RepositorySource {
  readonly kind = 'github' as const;
  async checkAccess(): Promise<void> {}
  async readText(relativePath: string): Promise<string> {
    if (relativePath === '.visual-director/manifest.json') {
      return JSON.stringify({ version: 1, project_id: 'game-b', subjects: {} });
    }
    return '# Canon';
  }
  async ensureFile(): Promise<void> {}
  async fileExists(relativePath: string): Promise<boolean> { return files.has(relativePath); }
}

describe('project diagnostics overview loading', () => {
  it('reuses one overview result for Approved Anchors and Grand Design diagnostics', async () => {
    let overviewLoads = 0;
    const result = await diagnoseProjectRepository(entry, new FakeSource(), async () => {
      overviewLoads += 1;
      return overview();
    });

    expect(result.state).toBe('ready');
    expect(overviewLoads).toBe(1);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'approved_anchors', state: 'ready' }),
      expect.objectContaining({ key: 'grand_design', state: 'ready' }),
    ]));
  });
});

function overview(): ProjectVisualOverview {
  return {
    project_id: 'game-b',
    visual_direction: {
      grand_design: { role: 'grand_design', asset_path: 'docs/visual/grand-design.webp' },
      global_style: { role: 'global_style' },
    },
    approved_anchors: [],
    workflow: { metadata_path: '.visual-director/asset-index.json', available: false, jobs: [], assets: [] },
  };
}
