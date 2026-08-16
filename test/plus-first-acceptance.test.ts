import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compileRepositoryCanon, COMPILED_CANON_RELATIVE_PATH } from '../src/compiled-canon.js';
import { CanonProjectAdapter } from '../src/projects/canon/adapter.js';
import { crownlessDefinition } from '../src/projects/crownless/definition.js';

const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { recursive: true, force: true })));
});

describe('Crownless Plus-first acceptance flow', () => {
  it('resolves World Direction, Approved Anchor, global reference, and policy without MCP', async () => {
    const repositoryPath = await crownlessRepository();
    const compiled = await compileRepositoryCanon({ projectId: 'crownless', repositoryPath });
    const persisted = JSON.parse(
      await readFile(path.join(repositoryPath, COMPILED_CANON_RELATIVE_PATH), 'utf8'),
    ) as typeof compiled;

    expect(persisted).toEqual(compiled);
    expect(compiled.project_id).toBe('crownless');
    expect(compiled.world_direction).toEqual(expect.arrayContaining([
      expect.stringContaining('fixed oblique top-down battlefield'),
      expect.stringContaining('playable medieval manuscript'),
    ]));
    expect(compiled.global_reference_path).toBe('docs/assets/crownless-visual-design-reference-v0.1.jpg');
    expect(compiled.subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subject_id: 'player-unarmed',
        approved_anchor_path: 'docs/assets/player-unarmed-approved-anchor-v0.2.webp',
      }),
    ]));
    expect(compiled.policy).toEqual({
      must_use_approved_anchor: true,
      must_not_chain_from_candidate: true,
      must_review_after_generation: true,
    });
  });

  it.each([
    ['battle screen', { screen: 'battle', camera: 'fixed oblique top-down' }],
    ['world map screen', { screen: 'world-map', exploration: 'progressively revealed manuscript map' }],
  ])('keeps repository-native %s preparation policy-equivalent to Core Canon resolution', async (_label, sceneContext) => {
    const repositoryPath = await crownlessRepository();
    const compiled = await compileRepositoryCanon({ projectId: 'crownless', repositoryPath });
    const adapter = new CanonProjectAdapter(crownlessDefinition, { repoPath: repositoryPath });
    const generationPackage = await adapter.prepare({
      project_id: 'crownless',
      asset_type: 'character_visual_anchor',
      subject_ids: ['player-unarmed'],
      request_text: 'Prepare Crownless visual generation under the current Canon.',
      scene_context: sceneContext,
    });

    const subject = compiled.subjects.find((candidate) => candidate.subject_id === 'player-unarmed');
    expect(subject).toBeDefined();
    expect(generationPackage.prompt_package.style_lock).toBe(compiled.global_style_lock);
    expect(generationPackage.prompt_package.subject_lock).toEqual([subject?.subject_lock]);
    expect(generationPackage.prompt_package.allowed_changes).toEqual(subject?.allowed_changes);
    expect(generationPackage.prompt_package.forbidden_changes).toEqual(subject?.forbidden_changes);
    expect(generationPackage.prompt_package.avoid_block).toEqual(compiled.avoid_block);
    expect(generationPackage.reference_assets).toEqual(expect.arrayContaining([
      { role: 'global_reference', path: compiled.global_reference_path },
      {
        role: 'subject_anchor',
        subject_id: 'player-unarmed',
        path: subject?.approved_anchor_path,
      },
    ]));
    expect(generationPackage.policy).toEqual(compiled.policy);
    expect(generationPackage.prompt_package.scene_requirements).toEqual(expect.arrayContaining([
      expect.stringContaining(`screen: ${sceneContext.screen}`),
    ]));
  });

  it('fails closed on missing approved reference assets without classifying transport as Canon', async () => {
    const repositoryPath = await crownlessRepository();
    await rm(path.join(repositoryPath, 'docs/assets/player-unarmed-approved-anchor-v0.2.webp'));

    await expect(compileRepositoryCanon({ projectId: 'crownless', repositoryPath }))
      .rejects.toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
  });
});

async function crownlessRepository(): Promise<string> {
  const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'visual-director-plus-first-'));
  repositories.push(repositoryPath);

  const files: Record<string, string> = {
    'docs/visual/GLOBAL_VISUAL_STYLE.md': `# Crownless Global Visual Style

## Global Visual Style Lock

\`\`\`text
Crownless living medieval manuscript style lock
\`\`\`

## Fixed Avoid Block

\`\`\`text
AVOID: photorealism, anime-gacha characters, glossy mobile RPG UI
\`\`\`

### Allowed Changes

- Pose may vary within the fixed oblique top-down battlefield.
- Framing may adapt to the requested screen.

### Forbidden Changes

- Do not drift from compact 3–3.5-head-tall manuscript proportions.
- Do not turn the player into a polished heroic fantasy character.
`,
    'docs/visual/CHARACTER_VISUAL_CANON.md': `# Crownless Character Visual Canon

## Common rules

- Keep compact folk-doll manuscript proportions.
- Keep faces restrained and non-anime.

## 素手の主人公

### Approved Visual Anchor

- \`docs/assets/player-unarmed-approved-anchor-v0.2.webp\`

### Accepted visual conditions

- anonymous unknown survivor
- intentionally unarmed
- oblique top-down combat readability
`,
    'docs/visual/WORLD_DIRECTION.md': `# Crownless Visual World Direction

- Crownless is a playable medieval manuscript whose world gains knowledge through exploration.
- Combat uses a fixed oblique top-down battlefield and must remain readable at phone scale.
- World maps use progressively revealed manuscript geography.
- The unarmed player is an unknown survivor and bare-handed combat is legitimate.
`,
    'docs/assets/README.md': '# Crownless Visual Reference Assets\n',
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(repositoryPath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, 'utf8');
  }

  for (const relativePath of [
    'docs/assets/crownless-visual-design-reference-v0.1.jpg',
    'docs/assets/player-unarmed-approved-anchor-v0.2.webp',
  ]) {
    const absolutePath = path.join(repositoryPath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from('fixture'));
  }

  return repositoryPath;
}
