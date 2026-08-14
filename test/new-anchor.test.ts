import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BottomOfThirstAdapter, configuredSubjects } from '../src/projects/bottom-of-thirst/adapter.js';

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-director-new-anchor-'));
  await createFixture(fixtureRoot);
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('new Visual Anchor candidate mode', () => {
  it('registers Kamino Kyosuke and Mikoshiba as known Bottom of Thirst subjects', () => {
    expect(configuredSubjects()).toEqual(expect.arrayContaining(['kamino_kyosuke', 'mikoshiba']));
  });

  it('prepares Kamino without borrowing any other character anchor', async () => {
    const result = await new BottomOfThirstAdapter({ repoPath: fixtureRoot }).prepare({
      project_id: 'bottom-of-thirst',
      asset_type: 'character_visual_anchor',
      subject_ids: ['kamino_kyosuke'],
      request_text: '神野恭介のv2 default / framing Visual Anchorを作る。',
      scene_context: { state: 'default/framing' },
    });

    expect(result.policy.must_use_approved_anchor).toBe(false);
    expect(result.reference_assets).toEqual([
      { role: 'global_reference', path: 'docs/visual/assets/global_visual_style_reference.webp' },
    ]);
    expect(result.prompt_package.subject_lock).toHaveLength(1);
    expect(result.prompt_package.subject_lock[0]).toContain('神野 恭介');
    expect(result.prompt_package.subject_lock[0]).toContain('NEW VISUAL ANCHOR CANDIDATE');
    expect(result.prompt_package.subject_lock[0]).toContain('他キャラクターではなく、液晶へ先に視線が落ちる24歳の配信者');
    expect(result.prompt_package.subject_lock[0]).not.toContain('相馬 健人');
    expect(result.prompt_package.subject_lock[0]).not.toContain('御子柴 徹');
    expect(result.prompt_package.forbidden_changes.join(' ')).toContain(
      'Do not include any other character Approved Anchor',
    );
  });

  it('fails closed when a pending subject is requested as a normal derived asset', async () => {
    await expect(
      new BottomOfThirstAdapter({ repoPath: fixtureRoot }).prepare({
        project_id: 'bottom-of-thirst',
        asset_type: 'event_cg',
        subject_ids: ['kamino_kyosuke'],
        request_text: '神野恭介のイベントCG',
      }),
    ).rejects.toMatchObject({
      code: 'APPROVED_ANCHOR_NOT_FOUND',
      details: { required_asset_type_for_new_anchor: 'character_visual_anchor' },
    });
  });
});

async function createFixture(root: string): Promise<void> {
  const files: Record<string, string> = {
    'docs/visual/GLOBAL_VISUAL_STYLE.md': `# Global Style\n\n## Global Visual Style Lock\n\n\`\`\`text\nSTYLE LOCK: grounded semi-realistic digital illustration\n\`\`\`\n\n## Fixed Avoid Block\n\n\`\`\`text\nAVOID: photorealism, anime\n\`\`\`\n\n### 変更してよいもの\n- expression\n\n### 変更してはいけないもの\n- identity\n`,
    'docs/visual/CHARACTER_VISUAL_CANON.md': `# Canon\n\n## 共通ルール\n- Do not mix character identity.\n\n## 相馬 健人\n\n### Approved Visual Anchor\n- \`public/images/characters/souma/v2/default.avif\`\n\n## 神野 恭介\n\n### Canonical state model\n- pending anchor\n`,
    'docs/WORLD_DIRECTION.md': '# World\n\n- grounded and observational\n- ordinary light\n',
    'docs/characters/kyosuke.md': '# 神野 恭介\n\n- 24歳\n- 日本人男性\n- ノイズチャンネルの動画配信者\n- 人より先に液晶を見る\n',
    'docs/visual/KAMINO_KYOSUKE_VISUAL_ANCHOR_V2_REQUIREMENTS.md': `# 神野 恭介 Visual Anchor v2 要件\n\n他キャラクターではなく、液晶へ先に視線が落ちる24歳の配信者として作る。\n\n- compact smartphone gimbal\n- dark practical tech/street clothing\n- low saturation\n- no detective styling\n- no geologist styling\n`,
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
