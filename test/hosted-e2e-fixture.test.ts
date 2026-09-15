import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createVisualDirectorCore } from '../src/core/visual-director.js';

const FIXTURE_ROOT = path.resolve('test/fixtures/hosted-e2e-project');
const PREPARE_INPUT = {
  project_id: 'hosted-e2e-fixture',
  asset_type: 'character_visual_anchor',
  subject_ids: ['fixture_subject'],
  request_text: 'Prepare the repository-owned Hosted E2E fixture from its Approved Visual Anchor.',
};

describe('Hosted E2E Canon fixture', () => {
  it('prepares through the production Core and catalog path', async () => {
    const prepared = await createVisualDirectorCore().prepareGeneration(PREPARE_INPUT);

    const grandDesignLock = prepared.prompt_package.grand_design_lock;
    expect(grandDesignLock).toBeTypeOf('string');
    expect(JSON.parse(grandDesignLock as string)).toMatchObject({
      schema_version: 1,
      project_id: 'hosted-e2e-fixture',
    });
    expect(prepared.prompt_package.grand_design_contract).toBeUndefined();
    expect(prepared.prompt_package.style_lock).toContain('STYLE LOCK');
    expect(prepared.prompt_package.subject_lock.join('\n')).toContain('Fixture Subject (fixture_subject)');
    expect(prepared.prompt_package.scene_requirements).toContain('World direction: Use a neutral fictional test environment.');
    expect(prepared.prompt_package.allowed_changes).toContain('Scene composition may change within the fixture request.');
    expect(prepared.prompt_package.forbidden_changes).toContain('Use the Approved Visual Anchor as the authoritative generation parent for the fixture subject.');
    expect(prepared.prompt_package.avoid_block).toEqual([
      'unrelated visual references',
      'identity drift',
      'candidate chaining',
    ]);
    expect(prepared.reference_assets).toContainEqual({
      role: 'global_reference',
      path: 'docs/visual/assets/global-reference.png',
    });
    expect(prepared.reference_assets).toContainEqual({
      role: 'subject_anchor',
      subject_id: 'fixture_subject',
      path: 'docs/visual/assets/fixture-subject-anchor.png',
    });
    expect(prepared.policy).toEqual({
      must_use_approved_anchor: true,
      must_not_chain_from_candidate: true,
      must_review_after_generation: true,
    });
  });

  it('fails closed when a required Global Visual Style section is removed', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'visual-director-hosted-e2e-'));
    const projectRoot = path.join(tempRoot, 'project');
    cpSync(FIXTURE_ROOT, projectRoot, { recursive: true });

    const stylePath = path.join(projectRoot, 'docs/visual/style.md');
    const style = readFileSync(stylePath, 'utf8');
    writeFileSync(stylePath, style.replace(/\n## Fixed Avoid Block[\s\S]*$/, '\n'), 'utf8');

    await expect(createVisualDirectorCore().prepareGeneration({
      ...PREPARE_INPUT,
      scene_context: { repository_path: projectRoot },
    })).rejects.toMatchObject({ code: 'GLOBAL_STYLE_INCOMPLETE' });
  });
});
