import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  asset_type: 'character_visual_anchor',
  subject_ids: ['souma'],
  request_text: 'Approved Visual Anchor を正本として生成パッケージを準備する',
};

describe('Visual Director Core', () => {
  it('prepares directly without an MCP server or prior configure_project call', async () => {
    const core = createVisualDirectorCore();
    const result = await core.prepareGeneration({
      ...request,
      scene_context: {
        repository_path: fixtureRoot,
        location: '地下の記録保管庫',
      },
    });

    expect(result.project_id).toBe('bottom-of-thirst');
    expect(result.reference_assets).toContainEqual({
      role: 'subject_anchor',
      subject_id: 'souma',
      path: 'public/images/characters/souma/v2/default.avif',
    });
    expect(result.policy.must_use_approved_anchor).toBe(true);
    expect(result.prompt_package.scene_requirements.join(' ')).toContain('location: 地下の記録保管庫');
    expect(result.prompt_package.scene_requirements.join(' ')).not.toContain('repository_path');
  });

  it('keeps explicit repository_path request-scoped instead of creating runtime state', async () => {
    const core = createVisualDirectorCore();

    await expect(
      core.prepareGeneration({
        ...request,
        scene_context: { repository_path: fixtureRoot },
      }),
    ).resolves.toMatchObject({ project_id: 'bottom-of-thirst' });

    await expect(core.prepareGeneration(request)).rejects.toMatchObject({
      code: 'PROJECT_CONFIG_MISSING',
    });
  });

  it('fails closed for invalid request-scoped repository configuration', async () => {
    const core = createVisualDirectorCore();

    await expect(
      core.prepareGeneration({ ...request, scene_context: { repository_path: '   ' } }),
    ).rejects.toMatchObject({ code: 'PROJECT_CONFIG_INVALID' });
  });

  it('preserves Canon fail-closed behavior when the Approved Anchor is missing', async () => {
    await rm(path.join(fixtureRoot, 'public/images/characters/souma/v2/default.avif'));
    const core = createVisualDirectorCore();

    await expect(
      core.prepareGeneration({ ...request, scene_context: { repository_path: fixtureRoot } }),
    ).rejects.toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
  });
});

async function createFixture(root: string): Promise<void> {
  const files: Record<string, string> = {
    'docs/visual/GLOBAL_VISUAL_STYLE.md': `# Global Style\n\n## Global Visual Style Lock\n\n\`\`\`text\nSTYLE LOCK\n\`\`\`\n\n## Fixed Avoid Block\n\n\`\`\`text\nAVOID: photorealism, anime\n\`\`\`\n\n## 既存キャラクター差分生成フロー\n\n### 変更してよいもの\n- small facial expression\n- gaze\n- hand position\n\n### 変更してはいけないもの\n- face identity\n`,
    'docs/visual/CHARACTER_VISUAL_CANON.md': `# Canon\n\n## 共通ルール\n- Always use an approved anchor.\n\n## 相馬 健人\n\n### Approved Visual Anchor\n- \`public/images/characters/souma/v2/default.avif\`\n\n### 採用する視覚条件\n- 32歳の契約記者\n- 色褪せた濃紺のジャケット\n`,
    'docs/WORLD_DIRECTION.md': '# World\n\n- grounded and observational\n- ordinary light\n',
    'docs/characters/soma.md': '# Soma\n\n- contract reporter\n- careful with records\n',
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
