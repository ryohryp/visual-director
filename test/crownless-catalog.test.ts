import { describe, expect, it } from 'vitest';

import { createCatalogProjectAdapter } from '../src/projects/catalog-runtime.js';
import type { ProjectCatalogEntry } from '../src/projects/catalog.js';
import type { RepositorySource } from '../src/projects/repository-source.js';

const entry: ProjectCatalogEntry = {
  project_id: 'crownless',
  display_name: 'Crownless',
  repository: { owner: 'ryohryp', name: 'crownless' },
  ref: 'main',
  adapter_type: 'generic',
};

const files = new Map<string, string>([
  ['docs/visual/GLOBAL_VISUAL_STYLE.md', `# Crownless Global Visual Style

## Global Visual Style Lock

\`\`\`text
Crownless manuscript style lock
\`\`\`

## Fixed Avoid Block

\`\`\`text
AVOID: photorealism, anime-gacha characters
\`\`\`

### Allowed Changes

- Pose may vary within canon.

### Forbidden Changes

- Do not drift from the compact manuscript character grammar.
`],
  ['docs/visual/CHARACTER_VISUAL_CANON.md', `# Crownless Character Visual Canon

## Common rules

- Keep compact 3–3.5-head-tall folk-doll proportions.

## 素手の主人公

### Approved Visual Anchor

- \`docs/assets/player-unarmed-approved-anchor-v0.2.webp\`

### Accepted visual conditions

- anonymous unknown survivor
- intentionally unarmed
`],
  ['docs/visual/WORLD_DIRECTION.md', '- Medieval fantasy world direction.'],
  ['docs/assets/README.md', '# Crownless Visual Reference Assets'],
]);

const source: RepositorySource = {
  kind: 'github',
  async checkAccess() {},
  async readText(relativePath) {
    const contents = files.get(relativePath);
    if (contents === undefined) throw new Error(`missing fixture: ${relativePath}`);
    return contents;
  },
  async ensureFile() {},
  async fileExists() {
    return false;
  },
};

describe('Crownless catalog adapter', () => {
  it('prepares the approved unarmed protagonist anchor from Crownless Canon', async () => {
    const adapter = await createCatalogProjectAdapter(entry, source);

    const generationPackage = await adapter.prepare({
      project_id: 'crownless',
      asset_type: 'character_visual_anchor',
      subject_ids: ['player-unarmed'],
      request_text: 'Prepare the established unarmed protagonist without changing identity.',
    });

    expect(generationPackage.prompt_package.style_lock).toContain('Crownless manuscript style lock');
    expect(generationPackage.prompt_package.subject_lock).toEqual([
      expect.stringContaining('素手の主人公 (player-unarmed) - Approved Visual Anchor: docs/assets/player-unarmed-approved-anchor-v0.2.webp.'),
    ]);
    expect(generationPackage.reference_assets).toEqual(expect.arrayContaining([
      {
        role: 'global_reference',
        path: 'docs/assets/crownless-visual-design-reference-v0.1.jpg',
      },
      {
        role: 'subject_anchor',
        subject_id: 'player-unarmed',
        path: 'docs/assets/player-unarmed-approved-anchor-v0.2.webp',
      },
    ]));
    expect(generationPackage.policy.must_use_approved_anchor).toBe(true);
  });
});
