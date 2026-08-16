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
});
