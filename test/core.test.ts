import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createVisualDirectorCore } from '../src/core/visual-director.js';

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-director-core-'));
  await createFixture(fixtureRoot);
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

const request = {
  project_id: 'bottom-of-thirst',
  asset_type: 'event_cg',
  subject_ids: ['souma'],
  request_text: '地下の記録保管庫で記録を確認する',
};

describe('Visual Director Core', () => {
  it('prepares directly without an MCP server or prior configure_project call', async () => {
    const core = createVisualDirectorCore({ repoPath: fixtureRoot });
    const result = await core.prepareGeneration(request);

    expect(result).toMatchObject({
      project_id: 'bottom-of-thirst',
      asset_type: 'event_cg',
      policy: {
        must_use_approved_anchor: true,
        must_not_chain_from_candidate: true,
        must_review_after_generation: true,
      },
    });
    expect(result.reference_assets).toContainEqual({
      role: 'subject_anchor',
      subject_id: 'souma',
      path: 'public/images/characters/souma/v2/default.avif',
    });
  });

  it('keeps explicit repository_path request-scoped instead of creating runtime state', async () => {
    const core = createVisualDirectorCore();
    await expect(
      core.prepareGeneration({
        ...request,
        scene_context: { repository_path: fixtureRoot },
      }),
    ).resolves.toMatchObject({ project_id: 'bottom-of-thirst' });

    await expect(core.prepareGeneration(request)).rejects.toMatchObject({ code: 'PROJECT_CONFIG_MISSING' });
  });

  it('fails closed for invalid request-scoped repository configuration', async () => {
    const core = createVisualDirectorCore();
    await expect(core.prepareGeneration({
      ...request,
      scene_context: { repository_path: '   ' },
    })).rejects.toMatchObject({ code: 'PROJECT_CONFIG_INVALID' });
  });

  it('preserves Canon fail-closed behavior when the Approved Anchor is missing', async () => {
    const core = createVisualDirectorCore();
    await rm(path.join(fixtureRoot, 'public/images/characters/souma/v2/default.avif'));

    await expect(
      core.prepareGeneration({ ...request, scene_context: { repository_path: fixtureRoot } }),
    ).rejects.toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
  });

  it('returns visual direction and Approved Anchors without requiring workflow metadata', async () => {
    const core = createVisualDirectorCore();
    const result = await core.getProjectVisualOverview({
      project_id: 'bottom-of-thirst',
      repository_path: fixtureRoot,
    });

    expect(result.project_id).toBe('bottom-of-thirst');
    expect(result.visual_direction.global_style).toMatchObject({
      role: 'global_style',
      document_path: 'docs/visual/GLOBAL_VISUAL_STYLE.md',
      asset_path: 'docs/visual/assets/global_visual_style_reference.webp',
    });
    expect(result.approved_anchors).toContainEqual({
      subject_id: 'souma',
      display_name: '相馬 健人',
      asset_type: 'character_visual_anchor',
      path: 'public/images/characters/souma/v2/default.avif',
      status: 'approved',
    });
    expect(result.workflow).toMatchObject({
      metadata_path: '.visual-director/asset-index.json',
      available: false,
      jobs: [],
      assets: [],
    });
  });

  it('reads repository-managed Generation Job and asset metadata when present', async () => {
    const indexPath = path.join(fixtureRoot, '.visual-director/asset-index.json');
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(indexPath, JSON.stringify({
      version: 1,
      jobs: [{
        job_id: 'job-001',
        asset_type: 'event_cg',
        subject_ids: ['souma'],
        request_text: '地下の記録保管庫',
        status: 'registered',
      }],
      assets: [{
        asset_id: 'asset-001',
        job_id: 'job-001',
        asset_type: 'event_cg',
        status: 'candidate',
        path: 'output/imagegen/job-001.png',
        reference_paths: ['public/images/characters/souma/v2/default.avif'],
      }],
    }, null, 2), 'utf8');

    const core = createVisualDirectorCore();
    const result = await core.getProjectVisualOverview({
      project_id: 'bottom-of-thirst',
      repository_path: fixtureRoot,
    });

    expect(result.workflow.available).toBe(true);
    expect(result.workflow.jobs).toEqual([
      expect.objectContaining({ job_id: 'job-001', status: 'registered' }),
    ]);
    expect(result.workflow.assets).toEqual([
      expect.objectContaining({ asset_id: 'asset-001', status: 'candidate' }),
    ]);
  });

  it('fails explicitly when repository workflow metadata is malformed', async () => {
    const indexPath = path.join(fixtureRoot, '.visual-director/asset-index.json');
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(indexPath, '{"version":1,"jobs":"wrong","assets":[]}', 'utf8');

    const core = createVisualDirectorCore();
    await expect(core.getProjectVisualOverview({
      project_id: 'bottom-of-thirst',
      repository_path: fixtureRoot,
    })).rejects.toMatchObject({ code: 'WORKFLOW_INDEX_INVALID' });
  });
});

async function createFixture(root: string): Promise<void> {
  const files: Record<string, string> = {
    'docs/visual/GLOBAL_VISUAL_STYLE.md': `# Global Style\n\n## Global Visual Style Lock\n\n\`\`\`text\nSTYLE LOCK\n\`\`\`\n\n## Fixed Avoid Block\n\n\`\`\`text\nAVOID: photorealism, anime\n\`\`\`\n\n## 既存キャラクター差分生成フロー\n\n### 変更してよいもの\n- small facial expression\n- gaze\n- hand position\n\n### 変更してはいけないもの\n- face identity\n`,
    'docs/visual/CHARACTER_VISUAL_CANON.md': `# Canon\n\n## 共通ルール\n- Always use an approved anchor.\n\n## 相馬 健人\n\n### Approved Visual Anchor\n- \`public/images/characters/souma/v2/default.avif\`\n\n### 採用する視覚条件\n- 32歳の契約記者\n- 色褪せた濃紺のジャケット\n`,
    'docs/WORLD_DIRECTION.md': '# World\n\n- grounded and observational\n- ordinary light\n',
    'docs/characters/soma.md': '# Soma\n\n- contract reporter\n- careful with records\n',
    'docs/characters/saya.md': '# Saya\n',
    'docs/characters/hikawa.md': '# Hikawa Ruka\n',
    'docs/characters/kagami.md': '# Kagami\n',
    'docs/characters/kito.md': '# Kitou\n',
    'docs/characters/mikoshiba.md': '# Mikoshiba\n',
    'docs/characters/kyosuke.md': '# Kamino Kyosuke\n',
    'docs/visual/assets/README.md': '# Assets\n',
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }

  for (const relativePath of [
    'docs/visual/assets/global_visual_style_reference.webp',
    'public/images/characters/souma/v2/default.avif',
  ]) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from('fixture'));
  }
}
