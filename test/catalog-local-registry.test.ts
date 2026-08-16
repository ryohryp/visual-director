import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createCatalogRepositorySource } from '../src/projects/catalog-runtime.js';
import { parseProjectCatalog } from '../src/projects/catalog.js';

const originalRegistry = process.env.VISUAL_DIRECTOR_PROJECT_REGISTRY;

afterEach(() => {
  if (originalRegistry === undefined) delete process.env.VISUAL_DIRECTOR_PROJECT_REGISTRY;
  else process.env.VISUAL_DIRECTOR_PROJECT_REGISTRY = originalRegistry;
});

describe('catalog local repository mode', () => {
  it('resolves the project repository through the local Project Registry', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'visual-director-registry-'));
    const repo = path.join(root, 'game-a');
    mkdirSync(repo);
    writeFileSync(path.join(repo, 'canon.md'), '# Canon\n', 'utf8');
    const registryPath = path.join(root, 'projects.json');
    writeFileSync(registryPath, JSON.stringify({ projects: { 'game-a': { repository: repo } } }), 'utf8');
    process.env.VISUAL_DIRECTOR_PROJECT_REGISTRY = registryPath;

    const entry = parseProjectCatalog({
      projects: [{
        project_id: 'game-a',
        display_name: 'Game A',
        repository: 'owner/game-a',
        ref: 'main',
        adapter_type: 'generic',
      }],
    }).resolve('game-a');

    const source = createCatalogRepositorySource(entry, { repositoryMode: 'local' });
    expect(source.kind).toBe('local');
    await expect(source.readText('canon.md', 'Canon')).resolves.toBe('# Canon\n');
  });
});
