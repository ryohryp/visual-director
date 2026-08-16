import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createCatalogProjectAdapter } from '../src/projects/catalog-runtime.js';
import { parseProjectCatalog } from '../src/projects/catalog.js';
import { LocalRepositorySource } from '../src/projects/repository-source.js';

function catalogEntry(projectId = 'game-a') {
  return parseProjectCatalog({
    projects: [{
      project_id: projectId,
      display_name: 'Game A',
      repository: 'owner/game-a',
      ref: 'main',
      adapter_type: 'generic',
    }],
  }).resolve(projectId);
}

describe('catalog repository manifest adapter', () => {
  it('creates a generic adapter from the repository-owned manifest', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'visual-director-manifest-adapter-'));
    mkdirSync(path.join(root, '.visual-director'));
    writeFileSync(path.join(root, '.visual-director', 'manifest.json'), JSON.stringify({
      version: 1,
      project_id: 'game-a',
      subjects: {},
    }), 'utf8');

    const adapter = await createCatalogProjectAdapter(catalogEntry(), new LocalRepositorySource(root));
    expect(adapter.projectId).toBe('game-a');
  });

  it('rejects a repository manifest for a different project', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'visual-director-manifest-mismatch-'));
    mkdirSync(path.join(root, '.visual-director'));
    writeFileSync(path.join(root, '.visual-director', 'manifest.json'), JSON.stringify({
      version: 1,
      project_id: 'other-game',
    }), 'utf8');

    await expect(createCatalogProjectAdapter(catalogEntry(), new LocalRepositorySource(root)))
      .rejects.toThrow('Project manifest project_id does not match catalog project_id.');
  });
});
