import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BottomOfThirstAdapter } from '../src/projects/bottom-of-thirst/adapter.js';

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-director-approved-anchor-'));
  await createFixture(fixtureRoot);
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('Bottom of Thirst approved Visual Anchor preparation', () => {
  it('uses an existing Approved Anchor as the authoritative source even for character_visual_anchor', async () => {
    const result = await new BottomOfThirstAdapter({ repoPath: fixtureRoot }).prepare({
      project_id: 'bottom-of-thirst',
      asset_type: 'character_visual_anchor',
      subject_ids: ['kamino_kyosuke'],
      request_text: '神野恭介のApproved Visual Anchorを正本としてGeneration Packageを取得する。画像生成は行わない。',
    });

    expect(result.project_id).toBe('bottom-of-thirst');
    expect(result.asset_type).toBe('character_visual_anchor');
    expect(result.policy).toEqual({
      must_use_approved_anchor: true,
      must_not_chain_from_candidate: true,
      must_review_after_generation: true,
    });
    expect(result.reference_assets).toEqual([
      { role: 'global_reference', path: 'docs/visual/assets/global_visual_style_reference.webp' },
      {
        role: 'subject_anchor',
        subject_id: 'kamino_kyosuke',
        path: 'public/images/characters/kamino_kyosuke/v2/default.avif',
      },
    ]);

    const subjectLock = result.prompt_package.subject_lock.join('\n');
    expect(subjectLock).toContain('神野 恭介 (kamino_kyosuke) — Approved Visual Anchor');
    expect(subjectLock).toContain('public/images/characters/kamino_kyosuke/v2/default.avif');
    expect(subjectLock).toContain('24歳の日本人男性');
    expect(subjectLock).toContain('動画配信者');
    expect(subjectLock).toContain('grounded semi-realistic digital illustration');
    expect(subjectLock).toContain('黒〜暗い茶の髪');
    expect(subjectLock).toContain('テック／ストリート寄りの服装');
    expect(subjectLock).toContain('ジンバル');
    expect(subjectLock).not.toContain('NEW VISUAL ANCHOR CANDIDATE');
  });

  it('fails closed when the Approved Anchor primary asset is missing', async () => {
    await rm(path.join(fixtureRoot, 'public/images/characters/kamino_kyosuke/v2/default.avif'));

    await expect(
      new BottomOfThirstAdapter({ repoPath: fixtureRoot }).prepare({
        project_id: 'bottom-of-thirst',
        asset_type: 'character_visual_anchor',
        subject_ids: ['kamino_kyosuke'],
        request_text: 'Approved Anchorを使う。',
      }),
    ).rejects.toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
  });

  it('fails closed when the same-generation fallback declared in Canon is missing', async () => {
    await rm(path.join(fixtureRoot, 'public/images/characters/kamino_kyosuke/v2/default.webp'));

    await expect(
      new BottomOfThirstAdapter({ repoPath: fixtureRoot }).prepare({
        project_id: 'bottom-of-thirst',
        asset_type: 'character_visual_anchor',
        subject_ids: ['kamino_kyosuke'],
        request_text: 'Approved Anchorを使う。',
      }),
    ).rejects.toMatchObject({ code: 'APPROVED_ANCHOR_INCOMPLETE' });
  });
});

async function createFixture(root: string): Promise<void> {
  const files: Record<string, string> = {
    'docs/visual/GLOBAL_VISUAL_STYLE.md': `# Global Style\n\n## Global Visual Style Lock\n\n\`\`\`text\nSTYLE LOCK: grounded semi-realistic digital illustration.\n\`\`\`\n\n## Fixed Avoid Block\n\n\`\`\`text\nAVOID: photorealism, anime, identity drift\n\`\`\`\n\n## 既存キャラクター差分生成フロー\n\n### 変更してよいもの\n- small facial expression\n- gaze\n- hand position\n\n### 変更してはいけないもの\n- face identity\n- hairstyle\n- body proportions\n- perceived age\n- clothing identity\n- rendering style\n`,
    'docs/visual/CHARACTER_VISUAL_CANON.md': `# キャラクター Visual Anchor 正本\n\n## 共通ルール\n- Approved Visual Anchor を不変の基準にする。\n- 顔、年齢感、髪型、服、体格、描画密度はAnchorを優先する。\n\n## 神野 恭介\n\n### Approved Visual Anchor\n\n- \`public/images/characters/kamino_kyosuke/v2/default.avif\`\n- \`public/images/characters/kamino_kyosuke/v2/default.webp\`\n\n2026-08-14、ユーザー明示承認。\n\n### 採用する視覚条件\n\n- 24歳の日本人男性として見える\n- 現代日本の動画配信者として成立する\n- grounded semi-realistic digital illustration の描画密度を維持する\n- 低彩度で、黒〜暗い茶の髪を自然に保つ\n- 現実的なテック／ストリート寄りの服装\n- スマートフォンまたは小型カメラのジンバルを職業道具として持つ\n- defaultは笑顔固定ではなく framing\n\n### Canonical state model\n\n- default / framing は Approved Anchor を直接使う。\n`,
    'docs/WORLD_DIRECTION.md': '# World\n\n- grounded and observational\n- ordinary light\n',
    'docs/characters/kyosuke.md': `# 神野 恭介\n\n| 項目 | 内容 |\n|---|---|\n| 本名 | 神野 恭介 |\n| 年齢 | 24歳 |\n| 職業 | 動画配信者 |\n| 外見 | テック系ファッション。ジンバルカメラを装備。 |\n`,
    'docs/visual/assets/README.md': '# Assets\n\nApproved references only.\n',
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }

  for (const relativePath of [
    'docs/visual/assets/global_visual_style_reference.webp',
    'public/images/characters/kamino_kyosuke/v2/default.avif',
    'public/images/characters/kamino_kyosuke/v2/default.webp',
  ]) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from('fixture'));
  }
}
