import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const skillPath = path.resolve('plugin/visual-director/skills/visual-director/SKILL.md');

describe('Visual Director Canon-first generation gate', () => {
  it('requires repository Canon resolution before every image generation', async () => {
    const skill = await readFile(skillPath, 'utf8');

    expect(skill).toContain('Canon-first prompt preflight');
    expect(skill).toContain('今回の実行でGeneration Packageまたは`.visual-director/compiled-canon.json`を実際に読み');
    expect(skill).toContain('subjectless assetにも同じように適用する');
    expect(skill).toContain('subjectless assetだからGlobal Style確認を省略しない');
    expect(skill).toContain('issueや会話にCanon利用が宣言されていても、それをrepository確認の代替にしない');
  });

  it('stops before generation when the final prompt conflicts with Canon negatives', async () => {
    const skill = await readFile(skillPath, 'utf8');

    expect(skill).toContain('最終promptに`avoid_block`または`forbidden_changes`と意味的に矛盾する指示が残っている場合、画像生成ツールを呼ばない');
    expect(skill).toContain('`cinematic`、`painterly`、`photorealistic`、`AAA`、`anime`、`glossy`');
    expect(skill).toContain('Canonと矛盾したpromptを生成モデルへ送らないこと');
    expect(skill).toContain('最終promptが`global_style_lock`を土台としており');
  });

  it('does not invent character anchors for subjectless assets', async () => {
    const skill = await readFile(skillPath, 'utf8');

    expect(skill).toContain('subjectless assetでは、`subject_ids`をでっち上げず');
    expect(skill).toContain('subjectless assetの場合、人物Anchorを捏造せずに正式な生成経路を解決できる');
    expect(skill).toContain('world map / environment / UIのsubjectless asset');
  });
});
