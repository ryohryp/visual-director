import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { Client, InMemoryTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHttpServerForVisualDirector, createVisualDirectorServer } from '../src/mcp/server.js';
import { createProjectRegistry } from '../src/projects/registry.js';

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
      const structured = result.structuredContent as { prompt_package?: { scene_requirements?: string[] } };
      const sceneRequirements = structured.prompt_package?.scene_requirements ?? [];
      expect(sceneRequirements.join('\n')).toContain('location: 地下の記録保管庫');
      expect(sceneRequirements.join('\n')).not.toContain('repository_path');
      expect(sceneRequirements.join('\n')).not.toContain(fixtureRoot);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('keeps the same HTTP MCP session usable for a second new-anchor preparation', async () => {
    const { httpServer, sessions } = createHttpServerForVisualDirector();
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

    const address = httpServer.address();
    expect(address && typeof address !== 'string').toBe(true);
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral HTTP server address.');

    const client = new Client({ name: 'bootstrap-repeat-test-client', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(address as AddressInfo).port}/mcp`));
    const baseInput = {
      project_id: 'bottom-of-thirst',
      asset_type: 'character_visual_anchor',
      subject_ids: ['kamino_kyosuke'],
      request_text: 'Prepare the current Visual Anchor package for Kamino Kyosuke.',
    };

    try {
      await client.connect(transport);
      const first = await client.callTool({
        name: 'visual.prepare_generation',
        arguments: { ...baseInput, scene_context: { repository_path: fixtureRoot } },
      });
      const second = await client.callTool({ name: 'visual.prepare_generation', arguments: baseInput });

      expect(first.isError).not.toBe(true);
      expect(second.isError).not.toBe(true);
      expect(first.structuredContent).toMatchObject({
        project_id: 'bottom-of-thirst',
        asset_type: 'character_visual_anchor',
        policy: {
          must_use_approved_anchor: false,
          must_not_chain_from_candidate: true,
          must_review_after_generation: true,
        },
      });
      expect(second.structuredContent).toMatchObject({
        project_id: 'bottom-of-thirst',
        asset_type: 'character_visual_anchor',
        policy: {
          must_use_approved_anchor: false,
          must_not_chain_from_candidate: true,
          must_review_after_generation: true,
        },
      });
      expect(sessions.size).toBe(1);
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('retains configure_project binding across MCP sessions in one HTTP server lifecycle', async () => {
    const { httpServer, sessions } = createHttpServerForVisualDirector();
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

    const address = httpServer.address();
    expect(address && typeof address !== 'string').toBe(true);
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral HTTP server address.');

    const endpoint = new URL(`http://127.0.0.1:${(address as AddressInfo).port}/mcp`);
    const configureClient = new Client({ name: 'binding-configure-client', version: '0.1.0' });
    const prepareClient = new Client({ name: 'binding-prepare-client', version: '0.1.0' });
    const configureTransport = new StreamableHTTPClientTransport(endpoint);
    const prepareTransport = new StreamableHTTPClientTransport(endpoint);
    const input = {
      project_id: 'bottom-of-thirst',
      asset_type: 'event_cg',
      subject_ids: ['souma'],
      request_text: '地下の記録保管庫で記録を確認する',
    };

    try {
      await configureClient.connect(configureTransport);
      await prepareClient.connect(prepareTransport);

      const configured = await configureClient.callTool({
        name: 'visual.configure_project',
        arguments: { project_id: input.project_id, repository_path: fixtureRoot },
      });
      const prepared = await prepareClient.callTool({ name: 'visual.prepare_generation', arguments: input });

      expect(configured.isError).not.toBe(true);
      expect(prepared.isError).not.toBe(true);
      expect(prepared.structuredContent).toMatchObject({
        project_id: 'bottom-of-thirst',
        policy: {
          must_use_approved_anchor: true,
          must_not_chain_from_candidate: true,
        },
        reference_assets: [
          { role: 'global_reference', path: 'docs/visual/assets/global_visual_style_reference.webp' },
          { role: 'subject_anchor', subject_id: 'souma', path: 'public/images/characters/souma/v2/default.avif' },
        ],
      });
      expect(sessions.size).toBe(2);
    } finally {
      await configureClient.close();
      await prepareClient.close();
      await new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('returns a JSON-RPC stale-session error and accepts a fresh initialization', async () => {
    const { httpServer, sessions } = createHttpServerForVisualDirector();
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

    const address = httpServer.address();
    expect(address && typeof address !== 'string').toBe(true);
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral HTTP server address.');

    const endpoint = `http://127.0.0.1:${(address as AddressInfo).port}/mcp`;
    const staleResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-06-18',
        'mcp-session-id': 'stale-session-from-a-previous-process',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'stale-session-test', version: '0.1.0' },
        },
      }),
    });

    expect(staleResponse.status).toBe(404);
    expect(await staleResponse.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32001 } });

    const client = new Client({ name: 'fresh-session-test', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint));
    try {
      await client.connect(transport);
      expect(transport.sessionId).toBeTruthy();
      expect(sessions.size).toBe(1);
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('fails closed when no binding exists and never reuses another project binding', async () => {
    const previousBottomOfThirstPath = process.env.BOTTOM_OF_THIRST_REPO_PATH;
    delete process.env.BOTTOM_OF_THIRST_REPO_PATH;
    try {
      const personalOrbitRoot = path.join(fixtureRoot, 'personal-orbit-repository');
      await mkdir(personalOrbitRoot, { recursive: true });
      const registry = createProjectRegistry();
      await registry.configureProject('personal-orbit', personalOrbitRoot);

      expect(() => registry.resolve('bottom-of-thirst')).toThrowError(
        expect.objectContaining({ code: 'PROJECT_CONFIG_MISSING' }),
      );
    } finally {
      if (previousBottomOfThirstPath === undefined) delete process.env.BOTTOM_OF_THIRST_REPO_PATH;
      else process.env.BOTTOM_OF_THIRST_REPO_PATH = previousBottomOfThirstPath;
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
      expect(JSON.parse(content[0]?.text ?? '{}')).toMatchObject({ error: 'PROJECT_CONFIG_INVALID' });
    } finally {
      await client.close();
      await server.close();
    }
  });
});

async function createFixture(root: string): Promise<void> {
  const files: Record<string, string> = {
    '.visual-director/manifest.json': JSON.stringify({
      version: 1,
      project_id: 'bottom-of-thirst',
      labels: {
        allowedChangesHeading: '変更してよいもの',
        forbiddenChangesHeading: '変更してはいけないもの',
        commonRulesHeading: '共通ルール',
        acceptedConditionsHeading: '採用する視覚条件',
      },
      subjects: {
        souma: {
          display_name: '相馬 健人',
          character_file: 'docs/characters/soma.md',
          canon_heading: '相馬 健人',
        },
        kamino_kyosuke: {
          display_name: '神野 恭介',
          character_file: 'docs/characters/kyosuke.md',
          canon_heading: '神野 恭介',
          aliases: ['神野恭介', '神野', '恭介'],
          anchor_requirements_file: 'docs/visual/KYOSUKE_VISUAL_ANCHOR_V2_REQUIREMENTS.md',
          required_new_anchor_terms: ['24歳', '動画配信者', 'ジンバル'],
        },
      },
    }),
    'docs/visual/GLOBAL_VISUAL_STYLE.md': `# Global Style\n\n## Global Visual Style Lock\n\n\`\`\`text\nSTYLE LOCK\n\`\`\`\n\n## Fixed Avoid Block\n\n\`\`\`text\nAVOID: photorealism, anime\n\`\`\`\n\n### 変更してよいもの\n- small facial expression\n- gaze\n- hand position\n\n### 変更してはいけないもの\n- face identity\n`,
    'docs/visual/CHARACTER_VISUAL_CANON.md': `# Canon\n\n## 共通ルール\n- Always use an approved anchor.\n\n## 相馬 健人\n\n### Approved Visual Anchor\n- \`public/images/characters/souma/v2/default.avif\`\n\n### 採用する視覚条件\n- 32歳の契約記者\n- 色褪せた濃紺のジャケット\n\n### Canonical state model\n- Use one default anchor.\n\n## 神野 恭介\n\n### Canonical state model\n- pending anchor\n`,
    'docs/WORLD_DIRECTION.md': '# World\n\n- grounded and observational\n- ordinary light\n',
    'docs/characters/soma.md': '# Soma\n\n- contract reporter\n- careful with records\n',
    'docs/characters/kyosuke.md': '# Kyosuke\n\n- 24歳の動画配信者\n- ジンバルを使う\n',
    'docs/visual/KYOSUKE_VISUAL_ANCHOR_V2_REQUIREMENTS.md': '# Requirements\n\n- 24歳の動画配信者\n- ジンバルを使う\n',
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
