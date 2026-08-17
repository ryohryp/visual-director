import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { compileRepositoryCanon, COMPILED_CANON_RELATIVE_PATH } from '../src/compiled-canon.js';

const repositories: string[] = [];
afterEach(async () => { await Promise.all(repositories.splice(0).map((repository) => rm(repository, { recursive: true, force: true }))); });

describe('compiled Canon', () => {
  it('writes deterministic repository-native Crownless Canon including structured grand design', async () => {
    const repositoryPath = await crownlessRepository();
    const first = await compileRepositoryCanon({ projectId: 'crownless', repositoryPath });
    const firstSerialized = await readFile(path.join(repositoryPath, COMPILED_CANON_RELATIVE_PATH), 'utf8');
    const second = await compileRepositoryCanon({ projectId: 'crownless', repositoryPath });
    const secondSerialized = await readFile(path.join(repositoryPath, COMPILED_CANON_RELATIVE_PATH), 'utf8');

    expect(second).toEqual(first);
    expect(secondSerialized).toBe(firstSerialized);
    expect(first.project_id).toBe('crownless');
    expect(first.grand_design?.visual_dna).toBe('Crownless Grand Design');
    expect(first.grand_design?.asset_types.background).toEqual({ purpose: 'silhouette-first readability' });
    expect(first.global_reference_path).toBe('docs/assets/crownless-visual-design-reference-v0.1.jpg');
    expect(first.policy.must_use_approved_anchor).toBe(true);
    expect(first.subjects).toEqual([expect.objectContaining({ subject_id: 'player-unarmed', approved_anchor_path: 'docs/assets/player-unarmed-approved-anchor-v0.2.webp' })]);
    expect(first.world_direction).toContain('Medieval fantasy world direction.');
    expect(firstSerialized).not.toContain('Compile repository Canon.');
    expect(firstSerialized).not.toContain('repository_path');
  });

  it('fails --check when Grand Design semantic content is stale', async () => {
    const repositoryPath = await crownlessRepository();
    await compileRepositoryCanon({ projectId: 'crownless', repositoryPath });
    await writeFile(path.join(repositoryPath, '.visual-director/grand-design.json'), JSON.stringify(grandDesign('changed')), 'utf8');
    await expect(compileRepositoryCanon({ projectId: 'crownless', repositoryPath, check: true })).rejects.toMatchObject({ code: 'COMPILED_CANON_STALE' });
  });

  it('rejects a repository manifest for another project', async () => {
    const repositoryPath = await crownlessRepository();
    const manifestPath = path.join(repositoryPath, '.visual-director/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.project_id = 'other-game';
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    await expect(compileRepositoryCanon({ projectId: 'crownless', repositoryPath })).rejects.toMatchObject({ code: 'PROJECT_MANIFEST_INVALID' });
  });

  it('rejects compiled Canon output paths that escape the repository', async () => {
    const repositoryPath = await crownlessRepository();
    await expect(compileRepositoryCanon({ projectId: 'crownless', repositoryPath, outputPath: '../compiled-canon.json' })).rejects.toMatchObject({ code: 'COMPILED_CANON_OUTPUT_INVALID' });
  });
});

function grandDesign(visualDna = 'Crownless Grand Design') {
  return {
    schema_version: 1,
    project_id: 'crownless',
    visual_dna: visualDna,
    shared_rules: { manuscript_density: true },
    fixed_avoid: ['photorealism'],
    asset_types: { background: { purpose: 'silhouette-first readability' } },
  };
}

async function crownlessRepository(): Promise<string> {
  const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'visual-director-compiled-canon-'));
  repositories.push(repositoryPath);
  await mkdir(path.join(repositoryPath, '.visual-director'), { recursive: true });
  await mkdir(path.join(repositoryPath, 'docs/visual'), { recursive: true });
  await mkdir(path.join(repositoryPath, 'docs/assets'), { recursive: true });
  await writeFile(path.join(repositoryPath, '.visual-director/manifest.json'), JSON.stringify({
    version: 1,
    project_id: 'crownless',
    documents: {
      grandDesign: '.visual-director/grand-design.json',
      globalStyle: 'docs/visual/GLOBAL_VISUAL_STYLE.md', characterCanon: 'docs/visual/CHARACTER_VISUAL_CANON.md', worldDirection: 'docs/visual/WORLD_DIRECTION.md', assetManifest: 'docs/assets/README.md', globalReference: 'docs/assets/crownless-visual-design-reference-v0.1.jpg',
    },
    labels: { avoidBlockHeading: 'Fixed Avoid Block', allowedChangesHeading: 'Allowed Changes', forbiddenChangesHeading: 'Forbidden Changes', commonRulesHeading: 'Common rules', acceptedConditionsHeading: 'Accepted visual conditions' },
    subjects: { 'player-unarmed': { display_name: '素手の主人公', character_file: 'docs/visual/CHARACTER_VISUAL_CANON.md', canon_heading: '素手の主人公' } },
  }), 'utf8');
  await writeFile(path.join(repositoryPath, '.visual-director/grand-design.json'), JSON.stringify(grandDesign()), 'utf8');
  await writeFile(path.join(repositoryPath, 'docs/visual/GLOBAL_VISUAL_STYLE.md'), '# Crownless Global Visual Style\n\n## Global Visual Style Lock\n\n```text\nCrownless manuscript style lock\n```\n\n## Fixed Avoid Block\n\n```text\nAVOID: photorealism, anime-gacha characters\n```\n\n### Allowed Changes\n\n- Pose may vary within canon.\n\n### Forbidden Changes\n\n- Do not drift from the compact manuscript character grammar.\n', 'utf8');
  await writeFile(path.join(repositoryPath, 'docs/visual/CHARACTER_VISUAL_CANON.md'), '# Crownless Character Visual Canon\n\n## Common rules\n\n- Keep compact folk-doll proportions.\n\n## 素手の主人公\n\n### Approved Visual Anchor\n\n- `docs/assets/player-unarmed-approved-anchor-v0.2.webp`\n\n### Accepted visual conditions\n\n- anonymous unknown survivor\n- intentionally unarmed\n', 'utf8');
  await writeFile(path.join(repositoryPath, 'docs/visual/WORLD_DIRECTION.md'), '- Medieval fantasy world direction.\n', 'utf8');
  await writeFile(path.join(repositoryPath, 'docs/assets/README.md'), '# Crownless Visual Reference Assets\n', 'utf8');
  await writeFile(path.join(repositoryPath, 'docs/assets/crownless-visual-design-reference-v0.1.jpg'), 'reference', 'utf8');
  await writeFile(path.join(repositoryPath, 'docs/assets/player-unarmed-approved-anchor-v0.2.webp'), 'anchor', 'utf8');
  return repositoryPath;
}
