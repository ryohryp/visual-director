import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { createVisualDirectorServer } from '../src/mcp/server.js';
import { approvedAnchorPaths, BottomOfThirstAdapter } from '../src/projects/bottom-of-thirst/adapter.js';

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-director-fixture-'));
  await createFixture(fixtureRoot);
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

const input = {
  project_id: 'bottom-of-thirst',
  asset_type: 'event_cg',
  subject_ids: ['souma'],
  request_text: '地下の記録保管庫で古い記録を確認しているイベントCG',
  scene_context: { location: '地下の記録保管庫', story_state: 'present_day_investigation' },
};

describe('BottomOfThirstAdapter', () => {
  it('keeps only contiguous exact anchor paths before metadata and legacy bullets', () => {
    expect(
      approvedAnchorPaths(
        '- `v2/anchor.avif`\n- runtime alpha mask: `v2/mask.avif`\n\nAnchor explanation.\n\n- `legacy/madness.png`',
      ),
    ).toEqual(['v2/anchor.avif']);
    expect(approvedAnchorPaths('- `v2/default.avif`\n- `v2/default.webp`\n')).toEqual([
      'v2/default.avif',
      'v2/default.webp',
    ]);
    expect(approvedAnchorPaths('Anchor explanation.\n\n- `legacy/madness.png`')).toEqual([]);
  });

  it('builds a separated, canon-backed Generation Package', async () => {
    const result = await new BottomOfThirstAdapter({ repoPath: fixtureRoot }).prepare(input);

    expect(result.project_id).toBe('bottom-of-thirst');
    expect(result.prompt_package.style_lock).toContain('STYLE LOCK');
    expect(result.prompt_package.subject_lock[0]).toContain('Approved Visual Anchor');
    expect(result.prompt_package.subject_lock[0]).toContain('相馬 健人');
    expect(result.prompt_package.scene_requirements).toContain('Scene context: location: 地下の記録保管庫, story_state: present_day_investigation');
    expect(result.prompt_package.allowed_changes).toEqual(['small facial expression', 'gaze', 'hand position']);
    expect(result.prompt_package.forbidden_changes.join(' ')).toContain('Approved Visual Anchor');
    expect(result.prompt_package.avoid_block).toEqual(['photorealism', 'anime']);
    expect(result.reference_assets).toEqual([
      { role: 'global_reference', path: 'docs/visual/assets/global_visual_style_reference.webp' },
      { role: 'subject_anchor', subject_id: 'souma', path: 'public/images/characters/souma/v2/default.avif' },
    ]);
    expect(result.policy).toEqual({
      must_use_approved_anchor: true,
      must_not_chain_from_candidate: true,
      must_review_after_generation: true,
    });
  });

  it('fails closed for an unknown subject', async () => {
    await expect(
      new BottomOfThirstAdapter({ repoPath: fixtureRoot }).prepare({ ...input, subject_ids: ['does-not-exist'] }),
    ).rejects.toMatchObject({ code: 'SUBJECT_NOT_FOUND' });
  });

  it('fails closed when the approved anchor is missing', async () => {
    await rm(path.join(fixtureRoot, 'public/images/characters/souma/v2/default.avif'));
    await expect(new BottomOfThirstAdapter({ repoPath: fixtureRoot }).prepare(input)).rejects.toMatchObject({
      code: 'REFERENCE_NOT_FOUND',
    });
  });

  it('fails closed when the visual reference asset manifest is missing', async () => {
    await rm(path.join(fixtureRoot, 'docs/visual/assets/README.md'));
    await expect(new BottomOfThirstAdapter({ repoPath: fixtureRoot }).prepare(input)).rejects.toMatchObject({
      code: 'CANON_READ_FAILED',
    });
  });
});

describe('MCP tool', () => {
  it('exposes visual.prepare_generation through the MCP protocol', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createVisualDirectorServer({ repoPath: fixtureRoot });
    const client = new Client({ name: 'visual-director-test-client', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('visual.prepare_generation');

    const result = await client.callTool({ name: 'visual.prepare_generation', arguments: input });
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content[0];
    expect(text?.type).toBe('text');
    expect(JSON.parse(text?.type === 'text' ? text.text ?? '{}' : '{}')).toMatchObject({
      project_id: 'bottom-of-thirst',
      asset_type: 'event_cg',
    });

    await client.close();
    await server.close();
  });

  it('returns an explicit MCP error instead of a fallback package', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createVisualDirectorServer({ repoPath: fixtureRoot });
    const client = new Client({ name: 'visual-director-test-client', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({ name: 'visual.prepare_generation', arguments: { ...input, subject_ids: ['missing'] } });
    expect(result.isError).toBe(true);
    const errorContent = result.content as Array<{ text: string }>;
    expect(JSON.parse(errorContent[0]?.text ?? '{}')).toMatchObject({ error: 'SUBJECT_NOT_FOUND' });

    await client.close();
    await server.close();
  });
});

async function createFixture(root: string): Promise<void> {
  const files: Record<string, string> = {
    'docs/visual/GLOBAL_VISUAL_STYLE.md': `# Global Style\n\n## Global Visual Style Lock\n\n\`\`\`text\nSTYLE LOCK\n\`\`\`\n\n## Fixed Avoid Block\n\n\`\`\`text\nAVOID: photorealism, anime\n\`\`\`\n\n## 既存キャラクター差分生成フロー\n\n### 変更してよいもの\n- small facial expression\n- gaze\n- hand position\n\n### 変更してはいけないもの\n- face identity\n`,
    'docs/visual/CHARACTER_VISUAL_CANON.md': `# Canon\n\n## 共通ルール\n- Always use an approved anchor.\n\n## 相馬 健人\n\n### Approved Visual Anchor\n- \`public/images/characters/souma/v2/default.avif\`\n\n### 採用する視覚条件\n- 32歳の契約記者\n- 色褪せた濃紺のジャケット\n\n### Canonical state model\n- Use one default anchor.\n\n## 水上 沙耶\n\n### Approved Visual Anchor\n- \`public/images/characters/saya/v2/default.avif\`\n`,
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
