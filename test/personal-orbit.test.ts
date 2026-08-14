import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PersonalOrbitAdapter } from '../src/projects/personal-orbit/adapter.js';
import { personalOrbitDefinition } from '../src/projects/personal-orbit/definition.js';
import { createProjectRegistry } from '../src/projects/registry.js';

let fixtureRoot: string;

const input = {
  project_id: 'personal-orbit',
  asset_type: 'town_scene',
  subject_ids: ['orby-town'],
  request_text: 'Orby Townで複数のエージェントが作業している街の全景',
  scene_context: { state: 'normal_operations' },
};

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'personal-orbit-visual-fixture-'));
  await createPersonalOrbitFixture(fixtureRoot);
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('PersonalOrbitAdapter', () => {
  it('builds an approved-anchor Generation Package for Orby Town', async () => {
    const result = await new PersonalOrbitAdapter(personalOrbitDefinition, { repoPath: fixtureRoot }).prepare(input);

    expect(result.project_id).toBe('personal-orbit');
    expect(result.asset_type).toBe('town_scene');
    expect(result.prompt_package.style_lock).toContain('ORBY TOWN STYLE LOCK');
    expect(result.prompt_package.subject_lock.join(' ')).toContain('Approved Visual Anchor');
    expect(result.prompt_package.scene_requirements).toContain('Scene context: state: normal_operations');
    expect(result.reference_assets).toEqual([
      {
        role: 'subject_anchor',
        subject_id: 'orby-town',
        path: 'public/dashboard/assets/agent-town/agent-town-map.png',
      },
    ]);
    expect(result.policy).toEqual({
      must_use_approved_anchor: true,
      must_not_chain_from_candidate: true,
      must_review_after_generation: true,
    });
  });

  it('fails closed when the approved Orby Town anchor is missing', async () => {
    await rm(path.join(fixtureRoot, 'public/dashboard/assets/agent-town/agent-town-map.png'));

    await expect(
      new PersonalOrbitAdapter(personalOrbitDefinition, { repoPath: fixtureRoot }).prepare(input),
    ).rejects.toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
  });

  it('fails closed for an unknown Personal Orbit subject', async () => {
    await expect(
      new PersonalOrbitAdapter(personalOrbitDefinition, { repoPath: fixtureRoot }).prepare({
        ...input,
        subject_ids: ['unknown'],
      }),
    ).rejects.toMatchObject({
      code: 'SUBJECT_NOT_FOUND',
      details: { known_subject_ids: ['orby-town'] },
    });
  });
});

describe('Personal Orbit runtime configuration', () => {
  it('binds personal-orbit through the existing runtime-only configureProject path', async () => {
    const registry = createProjectRegistry();

    await expect(registry.configureProject('personal-orbit', fixtureRoot)).resolves.toEqual({
      project_id: 'personal-orbit',
      repository_path: path.resolve(fixtureRoot),
      persistence: 'runtime',
    });

    await expect(registry.resolve('personal-orbit').prepare(input)).resolves.toMatchObject({
      project_id: 'personal-orbit',
      asset_type: 'town_scene',
    });
  });

  it('does not reuse the Bottom of Thirst fallback repository for Personal Orbit', () => {
    const previous = process.env.BOTTOM_OF_THIRST_REPO_PATH;
    process.env.BOTTOM_OF_THIRST_REPO_PATH = fixtureRoot;
    try {
      expect(() => createProjectRegistry().resolve('personal-orbit')).toThrowError(
        expect.objectContaining({ code: 'PROJECT_CONFIG_MISSING' }),
      );
    } finally {
      if (previous === undefined) delete process.env.BOTTOM_OF_THIRST_REPO_PATH;
      else process.env.BOTTOM_OF_THIRST_REPO_PATH = previous;
    }
  });
});

async function createPersonalOrbitFixture(root: string): Promise<void> {
  const files: Record<string, string | Buffer> = {
    'public/dashboard/agent-town-world.css': '.town-world { background: #c8dfb7; border-radius: 24px; }',
    'public/dashboard/agent-town-world.js': 'globalThis.AgentTownWorldCore = { WORLD_WIDTH: 1440, WORLD_HEIGHT: 960 };',
    'public/dashboard/agent-town-orby-canvas.js': 'globalThis.OrbyTownVisual = { agent: "orby" };',
    'public/dashboard/agent-town.html': '<main class="town-map"><div id="townWorld"></div></main>',
    'public/dashboard/assets/agent-town/agent-town-map.png': Buffer.from('approved-orby-town-anchor'),
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
}
