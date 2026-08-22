import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadProjectCatalog } from '../src/projects/catalog.js';

describe('bundled default Project Catalog', () => {
  it('loads the default catalog even when projects.catalog.json is absent from cwd', async () => {
    const previous = process.cwd();
    const directory = await mkdtemp(join(tmpdir(), 'visual-director-catalog-'));
    try {
      process.chdir(directory);
      expect(loadProjectCatalog('projects.catalog.json').resolve('personal-orbit')).toMatchObject({
        repository: { owner: 'ryohryp', name: 'personal-orbit' },
        ref: 'main',
        adapter_type: 'personal-orbit',
      });
      expect(loadProjectCatalog('projects.catalog.json').resolve('bottom-of-thirst')).toMatchObject({
        repository: { owner: 'ryohryp', name: '---The-Bottom-of-Thirst' },
        ref: 'main',
        adapter_type: 'generic',
      });
      expect(loadProjectCatalog('projects.catalog.json').resolve('crownless')).toMatchObject({
        repository: { owner: 'ryohryp', name: 'crownless' },
        ref: 'main',
        adapter_type: 'generic',
      });
    } finally {
      process.chdir(previous);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
