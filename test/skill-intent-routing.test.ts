import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const skillPath = path.resolve(
  process.cwd(),
  'plugin/visual-director/skills/visual-director/SKILL.md',
);

describe('Visual Director skill intent routing guard', () => {
  it('forbids image generation for registration and adoption intents', async () => {
    const skill = await readFile(skillPath, 'utf8');

    expect(skill).toContain('## 意図ルーティングゲート');
    expect(skill).toContain('現在のユーザー発話の動詞を最優先');
    expect(skill).toContain('採用・登録・保存・反映');
    expect(skill).toContain('**画像生成・画像編集ツールを呼ばない。**');
    expect(skill).toContain('「これ登録して」「これ採用」「これ反映して」');
    expect(skill).toContain('より良い画像を作り直す、透過版を再生成する、別バリエーションを作る、といった処理を勝手に挟まない');
  });

  it('allows image generation only for an explicit current-turn generate or edit intent', async () => {
    const skill = await readFile(skillPath, 'utf8');

    expect(skill).toContain('**この分類だけ**画像生成・画像編集ツールを呼べる');
    expect(skill).toContain('現在発話に生成・編集の明示がない場合');
    expect(skill).toContain('以前の「作って」「生成して」という依頼は画像候補が一度提示された時点で自動継続しない');
  });
});
