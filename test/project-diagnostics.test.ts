import { describe, expect, it } from 'vitest';

import type { ProjectVisualOverview } from '../src/domain/types.js';
import { VisualDirectorError } from '../src/domain/types.js';
import { diagnoseProjectRepository } from '../src/projects/diagnostics.js';
import type { RepositorySource } from '../src/projects/repository-source.js';

const entry = {
  project_id: 'game-b',
  display_name: 'Game B',
  repository: { owner: 'ryohryp', name: 'game-b' },
  ref: 'main',
  adapter_type: 'generic' as const,
};

class FakeSource implements RepositorySource {
  readonly kind = 'github' as const;
  constructor(
    private readonly files = new Set([
      'docs/visual/GLOBAL_VISUAL_STYLE.md',
      'docs/visual/CHARACTER_VISUAL_CANON.md',
      'docs/WORLD_DIRECTION.md',
      'docs/visual/assets/README.md',
      'docs/visual/assets/global_visual_style_reference.webp',
    ]),
    private readonly accessError?: VisualDirectorError,
  ) {}
  async checkAccess(): Promise<void> { if (this.accessError) throw this.accessError; }
  async readText(): Promise<string> { return '# Canon'; }
  async ensureFile(relativePath: string): Promise<void> {
    if (!this.files.has(relativePath)) throw new VisualDirectorError('REFERENCE_NOT_FOUND', 'missing', { path: relativePath });
  }
  async fileExists(relativePath: string): Promise<boolean> { return this.files.has(relativePath); }
}

describe('repository setup diagnostics', () => {
  it('reports optional Grand Design and uninitialized workflow without blocking a usable project', async () => {
    const result = await diagnoseProjectRepository(entry, new FakeSource(), async () => overview());
    expect(result.state).toBe('ready');
    expect(result.usable).toBe(true);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'grand_design', state: 'optional_missing', blocking: false }),
      expect.objectContaining({ key: 'workflow_index', state: 'not_initialized', blocking: false }),
    ]));
  });

  it('reports required Canon resources as blocking when missing', async () => {
    const files = new Set([
      'docs/visual/CHARACTER_VISUAL_CANON.md',
      'docs/WORLD_DIRECTION.md',
      'docs/visual/assets/README.md',
      'docs/visual/assets/global_visual_style_reference.webp',
    ]);
    const result = await diagnoseProjectRepository(entry, new FakeSource(files), async () => overview());
    expect(result.state).toBe('required_missing');
    expect(result.usable).toBe(false);
    expect(result.items).toContainEqual(expect.objectContaining({ key: 'global_style', state: 'required_missing' }));
  });

  it('uses Crownless project-specific Canon paths instead of generic defaults', async () => {
    const crownlessEntry = {
      project_id: 'crownless',
      display_name: 'Crownless',
      repository: { owner: 'ryohryp', name: 'crownless' },
      ref: 'main',
      adapter_type: 'generic' as const,
    };
    const files = new Set([
      'docs/visual/GLOBAL_VISUAL_STYLE.md',
      'docs/visual/CHARACTER_VISUAL_CANON.md',
      'docs/visual/WORLD_DIRECTION.md',
      'docs/assets/README.md',
      'docs/assets/crownless-visual-design-reference-v0.1.jpg',
    ]);
    const result = await diagnoseProjectRepository(crownlessEntry, new FakeSource(files), async () => overview('crownless'));
    expect(result.state).toBe('ready');
    expect(result.usable).toBe(true);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'world_direction', state: 'ready', path: 'docs/visual/WORLD_DIRECTION.md' }),
      expect.objectContaining({ key: 'asset_manifest', state: 'ready', path: 'docs/assets/README.md' }),
      expect.objectContaining({ key: 'global_reference', state: 'ready', path: 'docs/assets/crownless-visual-design-reference-v0.1.jpg' }),
    ]));
  });

  it('distinguishes repository access failures from missing Canon', async () => {
    const source = new FakeSource(undefined, new VisualDirectorError(
      'GITHUB_REPOSITORY_UNAVAILABLE',
      'The hosted Canon repository could not be read.',
      { status: 404 },
    ));
    const result = await diagnoseProjectRepository(entry, source, async () => overview());
    expect(result.state).toBe('access_error');
    expect(result.items).toContainEqual(expect.objectContaining({ key: 'repository_access', state: 'access_error' }));
  });

  it('reports broken Approved Anchor references separately', async () => {
    const result = await diagnoseProjectRepository(entry, new FakeSource(), async () => {
      throw new VisualDirectorError('REFERENCE_NOT_FOUND', 'Approved Anchor does not exist.', { path: 'anchors/missing.avif' });
    });
    expect(result.state).toBe('invalid_reference');
    expect(result.items).toContainEqual(expect.objectContaining({ key: 'approved_anchors', state: 'invalid_reference' }));
  });
});

function overview(projectId = 'game-b'): ProjectVisualOverview {
  return {
    project_id: projectId,
    visual_direction: { grand_design: null, global_style: { role: 'global_style' } },
    approved_anchors: [],
    workflow: { metadata_path: '.visual-director/asset-index.json', available: false, jobs: [], assets: [] },
  };
}
