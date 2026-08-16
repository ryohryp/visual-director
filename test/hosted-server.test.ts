import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHostedHttpServerForVisualDirector } from '../src/mcp/hosted-server.js';

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-director-hosted-server-'));
  await createFixture(fixtureRoot);
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('hosted HTTP server', () => {
  it('serves a lightweight health check', async () => {
    const server = createHostedHttpServerForVisualDirector({ repoPath: fixtureRoot });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ status: 'ok', mode: 'hosted-read-only' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves legacy 2025-era clients without an in-memory MCP session id', async () => {
    const { server, client, transport } = await connectClient({ mode: 'legacy' });
    try {
      expect(client.getProtocolEra()).toBe('legacy');
      expect(transport.sessionId).toBeUndefined();
      await expectPreparedPackage(client);
    } finally {
      await client.close().catch(() => undefined);
      await closeServer(server);
    }
  });

  it('serves a client pinned to protocol 2026-07-28', async () => {
    const { server, client, transport } = await connectClient({ mode: { pin: '2026-07-28' } });
    try {
      expect(client.getProtocolEra()).toBe('modern');
      expect(transport.sessionId).toBeUndefined();
      await expectPreparedPackage(client);

      const unknown = await client.callTool({
        name: 'visual.prepare_generation',
        arguments: {
          project_id: 'bottom-of-thirst',
          asset_type: 'character_visual_anchor',
          subject_ids: ['unknown-subject'],
          request_text: 'Unknown subjects must fail closed.',
        },
      });
      expect(unknown.isError).toBe(true);
      expect(unknown.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('SUBJECT_NOT_FOUND') }),
      ]));
    } finally {
      await client.close().catch(() => undefined);
      await closeServer(server);
    }
  });
});

async function connectClient(versionNegotiation: ConstructorParameters<typeof Client>[1]['versionNegotiation']) {
  const server = createHostedHttpServerForVisualDirector({ repoPath: fixtureRoot });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
  const client = new Client(
    { name: 'hosted-server-test', version: '0.1.0' },
    { versionNegotiation },
  );

  try {
    await client.connect(transport);
    return { server, client, transport };
  } catch (error) {
    await client.close().catch(() => undefined);
    await closeServer(server);
    throw error;
  }
}

async function expectPreparedPackage(client: Client): Promise<void> {
  const result = await client.callTool({
    name: 'visual.prepare_generation',
    arguments: {
      project_id: 'bottom-of-thirst',
      asset_type: 'character_visual_anchor',
      subject_ids: ['souma'],
      request_text: 'Prepare from the Approved Anchor.',
    },
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    project_id: 'bottom-of-thirst',
    policy: { must_use_approved_anchor: true },
    reference_assets: expect.arrayContaining([
      {
        role: 'global_reference',
        path: 'docs/visual/assets/global_visual_style_reference.webp',
      },
      {
        role: 'subject_anchor',
        path: 'public/images/characters/souma/v2/default.avif',
        subject_id: 'souma',
      },
    ]),
  });
}

async function closeServer(server: ReturnType<typeof createHostedHttpServerForVisualDirector>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function createFixture(root: string): Promise<void> {
  const files: Record<string, string> = {
    'docs/visual/GLOBAL_VISUAL_STYLE.md': `# Global Style\n\n## Global Visual Style Lock\n\n\`\`\`text\nSTYLE LOCK\n\`\`\`\n\n## Fixed Avoid Block\n\n\`\`\`text\nAVOID: photorealism, anime\n\`\`\`\n\n### 変更してよいもの\n- expression\n\n### 変更してはいけないもの\n- face identity\n`,
    'docs/visual/CHARACTER_VISUAL_CANON.md': `# Canon\n\n## 共通ルール\n- use approved anchors\n\n## 相馬 健人\n\n### Approved Visual Anchor\n- \`public/images/characters/souma/v2/default.avif\`\n\n### 採用する視覚条件\n- 32歳\n`,
    'docs/WORLD_DIRECTION.md': '# World\n\n- grounded\n',
    'docs/characters/soma.md': '# Soma\n\n- contract reporter\n',
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
