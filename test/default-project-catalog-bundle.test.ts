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
      expect(loadProjectCatalog('projects.catalog.json').resolve('bottom-of-thirst')).toMatchObject({
        repository: { owner: 'ryohryp', name: '---The-Bottom-of-Thirst' },
        ref: 'main',
        adapter_type: 'bottom-of-thirst',
      });
    } finally {
      process.chdir(previous);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
