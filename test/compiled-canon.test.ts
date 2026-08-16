import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compileRepositoryCanon, COMPILED_CANON_RELATIVE_PATH } from '../src/compiled-canon.js';

const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { recursive: true, force: true })));
});

describe('compiled Canon', () => {
  it('writes deterministic repository-native Crownless Canon without request-time data', async () => {
    const repositoryPath = await crownlessRepository();

    const first = await compileRepositoryCanon({ projectId: 'crownless', repositoryPath });
    const firstSerialized = await readFile(path.join(repositoryPath, COMPILED_CANON_RELATIVE_PATH), 'utf8');
    const second = await compileRepositoryCanon({ projectId: 'crownless', repositoryPath });
    const secondSerialized = await readFile(path.join(repositoryPath, COMPILED_CANON_RELATIVE_PATH), 'utf8');

    expect(second).toEqual(first);
    expect(secondSerialized).toBe(firstSerialized);
    expect(first.project_id).toBe('crownless');
    expect(first.global_reference_path).toBe('docs/assets/crownless-visual-design-reference-v0.1.jpg');
    expect(first.policy.must_use_approved_anchor).toBe(true);
    expect(first.subjects).toEqual([
      expect.objectContaining({
        subject_id: 'player-unarmed',
        approved_anchor_path: 'docs/assets/player-unarmed-approved-anchor-v0.2.webp',
      }),
    ]);
    expect(first.world_direction).toContain('Medieval fantasy world direction.');
    expect(firstSerialized).not.toContain('Compile repository Canon.');
    expect(firstSerialized).not.toContain('repository_path');
  });

  it('fails --check when Canon-derived output is stale', async () => {
    const repositoryPath = await crownlessRepository();
    await compileRepositoryCanon({ projectId: 'crownless', repositoryPath });
    await writeFile(
      path.join(repositoryPath, 'docs/visual/WORLD_DIRECTION.md'),
      '- Medieval fantasy world direction.\n- New canonical battlefield rule.\n',
      'utf8',
    );

    await expect(compileRepositoryCanon({ projectId: 'crownless', repositoryPath, check: true }))
      .rejects.toMatchObject({ code: 'COMPILED_CANON_STALE' });
  });

  it('rejects compiled Canon output paths that escape the repository', async () => {
    const repositoryPath = await crownlessRepository();

    await expect(compileRepositoryCanon({ projectId: 'crownless', repositoryPath, outputPath: '../compiled-canon.json' }))
      .rejects.toMatchObject({ code: 'COMPILED_CANON_OUTPUT_INVALID' });
  });
});

async function crownlessRepository(): Promise<string> {
  const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'visual-director-compiled-canon-'));
  repositories.push(repositoryPath);
  await mkdir(path.join(repositoryPath, 'docs/visual'), { recursive: true });
  await mkdir(path.join(repositoryPath, 'docs/assets'), { recursive: true });
  await writeFile(path.join(repositoryPath, 'docs/visual/GLOBAL_VISUAL_STYLE.md'), `# Crownless Global Visual Style

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
`, 'utf8');
  await writeFile(path.join(repositoryPath, 'docs/visual/CHARACTER_VISUAL_CANON.md'), `# Crownless Character Visual Canon

## Common rules

- Keep compact folk-doll proportions.

## 素手の主人公

### Approved Visual Anchor

- \`docs/assets/player-unarmed-approved-anchor-v0.2.webp\`

### Accepted visual conditions

- anonymous unknown survivor
- intentionally unarmed
`, 'utf8');
  await writeFile(path.join(repositoryPath, 'docs/visual/WORLD_DIRECTION.md'), '- Medieval fantasy world direction.\n', 'utf8');
  await writeFile(path.join(repositoryPath, 'docs/assets/README.md'), '# Crownless Visual Reference Assets\n', 'utf8');
  await writeFile(path.join(repositoryPath, 'docs/assets/crownless-visual-design-reference-v0.1.jpg'), 'reference', 'utf8');
  await writeFile(path.join(repositoryPath, 'docs/assets/player-unarmed-approved-anchor-v0.2.webp'), 'anchor', 'utf8');
  return repositoryPath;
}
