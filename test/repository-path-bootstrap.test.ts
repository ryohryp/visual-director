import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createVisualDirectorServer } from '../src/mcp/server.js';

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-director-bootstrap-'));
  await createFixture(fixtureRoot);
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('prepare_generation repository-path bootstrap compatibility', () => {
  it('binds the repository from scene_context.repository_path and strips the runtime path from the visual prompt', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createVisualDirectorServer();
    const client = new Client({ name: 'bootstrap-test-client', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: 'visual.prepare_generation',
        arguments: {
          project_id: 'bottom-of-thirst',
          asset_type: 'event_cg',
          subject_ids: ['souma'],
          request_text: '地下の記録保管庫で記録を確認する',
          scene_context: {
            repository_path: fixtureRoot,
            location: '地下の記録保管庫',
          },
        },
      });

      expect(result.isError).not.toBe(true);
      const structured = result.structuredContent as {
        prompt_package?: { scene_requirements?: string[] };
      };
      const sceneRequirements = structured.prompt_package?.scene_requirements ?? [];
      expect(sceneRequirements.join('\n')).toContain('location: 地下の記録保管庫');
      expect(sceneRequirements.join('\n')).not.toContain('repository_path');
      expect(sceneRequirements.join('\n')).not.toContain(fixtureRoot);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('fails explicitly when the compatibility repository path is invalid', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createVisualDirectorServer();
    const client = new Client({ name: 'bootstrap-test-client', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: 'visual.prepare_generation',
        arguments: {
          project_id: 'bottom-of-thirst',
          asset_type: 'event_cg',
          subject_ids: ['souma'],
          request_text: 'test',
          scene_context: { repository_path: 42 },
        },
      });

      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(JSON.parse(content[0]?.text ?? '{}')).toMatchObject({
        error: 'PROJECT_CONFIG_INVALID',
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});

async function createFixture(root: string): Promise<void> {
  const files: Record<string, string> = {
    'docs/visual/GLOBAL_VISUAL_STYLE.md': `# Global Style\n\n## Global Visual Style Lock\n\n\`\`\`text\nSTYLE LOCK\n\`\`\`\n\n## Fixed Avoid Block\n\n\`\`\`text\nAVOID: photorealism, anime\n\`\`\`\n\n## 既存キャラクター差分生成フロー\n\n### 変更してよいもの\n- small facial expression\n- gaze\n- hand position\n\n### 変更してはいけないもの\n- face identity\n`,
    'docs/visual/CHARACTER_VISUAL_CANON.md': `# Canon\n\n## 共通ルール\n- Always use an approved anchor.\n\n## 相馬 健人\n\n### Approved Visual Anchor\n- \`public/images/characters/souma/v2/default.avif\`\n\n### 採用する視覚条件\n- 32歳の契約記者\n- 色褪せた濃紺のジャケット\n\n### Canonical state model\n- Use one default anchor.\n`,
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
