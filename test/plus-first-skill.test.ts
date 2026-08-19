import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const skillPath = path.resolve('plugin/visual-director/skills/visual-director/SKILL.md');

describe('Visual Director Plus-first skill', () => {
  it('uses repository-native compiled Canon when MCP is unavailable', async () => {
    const skill = await readFile(skillPath, 'utf8');

    expect(skill).toContain('.visual-director/compiled-canon.json');
    expect(skill).toContain('repository-native経路へ切り替える');
    expect(skill).toContain('MCP failureをCanon failureとして扱わない');
    expect(skill).toContain('must_not_chain_from_candidate: true');
    expect(skill).toContain('must_review_after_generation: true');
    expect(skill).toContain('candidateやlegacyへfallbackしない');
  });

  it('does not require MCP prepare_generation as the only image-generation gate', async () => {
    const skill = await readFile(skillPath, 'utf8');

    expect(skill).not.toContain('`visual.prepare_generation`が成功している。');
    expect(skill).not.toContain('`visual.prepare_generation`が利用できない場合は、Visual Director MCP');
  });

  it('fails closed when conversation images cannot be isolated from native generation', async () => {
    const skill = await readFile(skillPath, 'utf8');

    expect(skill).toContain('Conversation image context isolation');
    expect(skill).toContain('「新規生成だから過去画像は使われない」と仮定しない');
    expect(skill).toContain('hostが今回のreferenceだけに明示限定できない');
    expect(skill).toContain('同じ誤参照が2回連続したら、そのcontextでは生成を停止');
    expect(skill).toContain('3回目を盲目的に再生成しない');
    expect(skill).toContain('dashboard / UI / report');
    expect(skill).toContain('local/tunnel限定の`visual.generate_image`');
    expect(skill).toContain('Generation Packageの`reference_assets`だけをgeneratorへ送る');
    expect(skill).toContain('Hosted read-onlyでは公開しない');
  });
});
