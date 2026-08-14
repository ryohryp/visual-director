import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createVisualDirectorServer } from '../src/mcp/server.js';
import { VisualDirectorError } from '../src/domain/types.js';
import { createProjectRegistry, registerApprovedAnchor } from '../src/projects/registry.js';

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-director-adopt-anchor-'));
  await mkdir(path.join(fixtureRoot, 'docs/visual/assets'), { recursive: true });
  await mkdir(path.join(fixtureRoot, 'docs/characters'), { recursive: true });
  await mkdir(path.join(fixtureRoot, 'assets/hero'), { recursive: true });
  await writeFile(path.join(fixtureRoot, 'docs/visual/CHARACTER_VISUAL_CANON.md'), '# Canon\n\n## The Hero\n\n### Canonical state model\n- pending_anchor\n');
  await writeFile(
    path.join(fixtureRoot, 'docs/visual/GLOBAL_VISUAL_STYLE.md'),
    '# Global Style\n\n## Global Visual Style Lock\n\n```text\nSTYLE LOCK: grounded illustration\n```\n\n## Fixed Avoid Block\n\n```text\nAVOID: photorealism\n```\n\n### Allowed changes\n- expression\n\n### Forbidden changes\n- identity\n',
  );
  await writeFile(path.join(fixtureRoot, 'docs/WORLD_DIRECTION.md'), '# World\n\n- grounded and observational\n');
  await writeFile(path.join(fixtureRoot, 'docs/visual/ASSET_MANIFEST.md'), '# Assets\n\n- global reference\n');
  await writeFile(path.join(fixtureRoot, 'docs/visual/assets/README.md'), '# Assets\n\n- global reference\n');
  await writeFile(path.join(fixtureRoot, 'docs/visual/assets/global_visual_style_reference.webp'), 'reference');
  await writeFile(path.join(fixtureRoot, 'docs/characters/hero.md'), '# Hero\n\n- A grounded protagonist.\n');
  await writeFile(path.join(fixtureRoot, 'assets/hero/candidate.png'), tinyPng());
  await writeFile(path.join(fixtureRoot, 'projects.json'), JSON.stringify({
    projects: {
      game: {
        repo_path: '.',
        documents: {
          global_style: 'docs/visual/GLOBAL_VISUAL_STYLE.md',
          character_canon: 'docs/visual/CHARACTER_VISUAL_CANON.md',
          world_direction: 'docs/WORLD_DIRECTION.md',
          asset_manifest: 'docs/visual/ASSET_MANIFEST.md',
          global_reference: 'docs/visual/assets/global_visual_style_reference.webp',
        },
        labels: {
          avoid_block_heading: 'Fixed Avoid Block',
          allowed_changes_heading: 'Allowed changes',
          forbidden_changes_heading: 'Forbidden changes',
          common_rules_heading: 'Common rules',
          accepted_conditions_heading: 'Accepted conditions',
        },
        subjects: {
          hero: { display_name: 'The Hero', character_file: 'docs/characters/hero.md', canon_heading: 'The Hero' },
        },
      },
    },
  }));
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('Anchor adoption and Canon registration', () => {
  it('registers an Approved Anchor through the MCP tools/call protocol', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createVisualDirectorServer({ projectsConfigPath: path.join(fixtureRoot, 'projects.json') });
    const client = new Client({ name: 'visual-director-adopt-anchor-test-client', version: '0.1.0' });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      const adoptTool = tools.tools.find((tool) => tool.name === 'visual.adopt_anchor');
      expect(adoptTool).toMatchObject({
        name: 'visual.adopt_anchor',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      });
      expect(adoptTool?._meta).toMatchObject({ 'openai/fileParams': ['candidate_file'] });
      expect(adoptTool?.inputSchema.properties?.candidate_file).toMatchObject({
        type: 'object',
        properties: {
          download_url: { type: 'string' },
          file_id: { type: 'string' },
          mime_type: { type: 'string' },
          file_name: { type: 'string' },
        },
        required: ['download_url', 'file_id'],
      });

      const result = await client.callTool({
        name: 'visual.adopt_anchor',
        arguments: {
          project_id: 'game',
          subject_id: 'hero',
          candidate_path: 'assets/hero/candidate.png',
          approval: 'approve',
        },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        project_id: 'game',
        subject_id: 'hero',
        approved_anchor_path: 'assets/hero/candidate.png',
        canon_path: 'docs/visual/CHARACTER_VISUAL_CANON.md',
        changed: true,
      });

      const repeated = await client.callTool({
        name: 'visual.adopt_anchor',
        arguments: {
          project_id: 'game',
          subject_id: 'hero',
          candidate_path: 'assets/hero/candidate.png',
          approval: 'approve',
        },
      });
      expect(repeated.isError).not.toBe(true);
      expect(repeated.structuredContent).toMatchObject({ changed: false });

      const prepared = await client.callTool({
        name: 'visual.prepare_generation',
        arguments: {
          project_id: 'game',
          asset_type: 'character_portrait',
          subject_ids: ['hero'],
          request_text: 'Prepare a portrait using the adopted Hero Anchor.',
        },
      });
      expect(prepared.isError).not.toBe(true);
      expect(prepared.structuredContent).toMatchObject({
        project_id: 'game',
        policy: {
          must_use_approved_anchor: true,
          must_not_chain_from_candidate: true,
        },
        reference_assets: [
          { role: 'global_reference', path: 'docs/visual/assets/global_visual_style_reference.webp' },
          { role: 'subject_anchor', subject_id: 'hero', path: 'assets/hero/candidate.png' },
        ],
      });
    } finally {
      await client.close();
      await server.close();
    }

    const canon = await readFile(path.join(fixtureRoot, 'docs/visual/CHARACTER_VISUAL_CANON.md'), 'utf8');
    expect(canon).toContain('### Approved Visual Anchor\n- `assets/hero/candidate.png`');
  });

  it('registers an explicitly approved repository candidate and is idempotent', async () => {
    const registry = createProjectRegistry({ projectsConfigPath: path.join(fixtureRoot, 'projects.json') });
    const input = {
      project_id: 'game',
      subject_id: 'hero',
      candidate_path: 'assets/hero/candidate.png',
      approval: 'approve' as const,
    };

    await expect(registry.adoptAnchor(input)).resolves.toMatchObject({
      subject_id: 'hero',
      approved_anchor_path: 'assets/hero/candidate.png',
      changed: true,
    });
    await expect(registry.adoptAnchor(input)).resolves.toMatchObject({ changed: false });
    const canon = await readFile(path.join(fixtureRoot, 'docs/visual/CHARACTER_VISUAL_CANON.md'), 'utf8');
    expect(canon.match(/### Approved Visual Anchor/g)).toHaveLength(1);
    expect(canon).toContain('- `assets/hero/candidate.png`');
  });

  it('refuses missing candidates, unsafe paths, and replacement of an existing Anchor', async () => {
    const registry = createProjectRegistry({ projectsConfigPath: path.join(fixtureRoot, 'projects.json') });
    await expect(registry.adoptAnchor({
      project_id: 'game', subject_id: 'hero', candidate_path: '../outside.avif', approval: 'approve',
    })).rejects.toMatchObject({ code: 'UNSAFE_REPOSITORY_PATH' });
    await expect(registry.adoptAnchor({
      project_id: 'game', subject_id: 'hero', candidate_path: 'assets/hero/missing.avif', approval: 'approve',
    })).rejects.toMatchObject({ code: 'ANCHOR_CANDIDATE_NOT_FOUND' });

    await registry.adoptAnchor({
      project_id: 'game', subject_id: 'hero', candidate_path: 'assets/hero/candidate.png', approval: 'approve',
    });
    await writeFile(path.join(fixtureRoot, 'assets/hero/other.png'), tinyPng());
    await expect(registry.adoptAnchor({
      project_id: 'game', subject_id: 'hero', candidate_path: 'assets/hero/other.png', approval: 'approve',
    })).rejects.toMatchObject({ code: 'APPROVED_ANCHOR_CONFLICT' });
  });

  it('downloads a ChatGPT file reference, saves the subject-defined Anchor, and returns image metadata', async () => {
    const registry = createProjectRegistry({
      projectsConfigPath: path.join(fixtureRoot, 'projects.json'),
      fetchImpl: async () => new Response(tinyPng(), { status: 200, headers: { 'content-type': 'image/png' } }),
    });

    const result = await registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'hero',
      candidate_file: {
        download_url: 'https://files.example.test/generated/hero.png',
        file_id: 'file-hero-png',
        mime_type: 'image/png',
        file_name: 'hero.png',
      },
      approval: 'approve',
    });

    expect(result).toMatchObject({
      status: 'approved',
      anchor_path: 'public/images/characters/hero/v2/default.png',
      approved_anchor_path: 'public/images/characters/hero/v2/default.png',
      mime_type: 'image/png',
      width: 1,
      height: 1,
      changed: true,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(readFile(path.join(fixtureRoot, result.anchor_path))).resolves.toEqual(tinyPng());
    await expect(readFile(path.join(fixtureRoot, 'docs/visual/CHARACTER_VISUAL_CANON.md'), 'utf8')).resolves.toContain(
      '- `public/images/characters/hero/v2/default.png`',
    );
  });

  it('accepts a JPEG file reference and keeps prepare_generation on the new Approved Anchor', async () => {
    const registry = createProjectRegistry({
      projectsConfigPath: path.join(fixtureRoot, 'projects.json'),
      fetchImpl: async () => new Response(tinyJpeg(), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    });
    const adopted = await registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'hero',
      candidate_file: {
        download_url: 'https://files.example.test/generated/hero.jpg',
        file_id: 'file-hero-jpeg',
        mime_type: 'image/jpeg',
        file_name: 'hero.jpg',
      },
      approval: 'approve',
    });

    expect(adopted.anchor_path).toBe('public/images/characters/hero/v2/default.jpg');
    const packageResult = await registry.resolve('game').prepare({
      project_id: 'game',
      asset_type: 'character_portrait',
      subject_ids: ['hero'],
      request_text: 'The Hero portrait',
    });
    expect(packageResult.reference_assets).toContainEqual({
      role: 'subject_anchor',
      subject_id: 'hero',
      path: 'public/images/characters/hero/v2/default.jpg',
    });
  });

  it('removes the Bottom of Thirst Kamino APPROVED_ANCHOR_NOT_FOUND state after adoption', async () => {
    await mkdir(path.join(fixtureRoot, 'docs/characters'), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, 'docs/visual/CHARACTER_VISUAL_CANON.md'),
      '# Canon\n\n## 共通ルール\n- Keep identity stable.\n\n## 神野 恭介\n\n### Canonical state model\n- pending anchor\n',
    );
    await writeFile(
      path.join(fixtureRoot, 'docs/characters/kyosuke.md'),
      '# 神野 恭介\n\n| 項目 | 内容 |\n|---|---|\n| 年齢 | 24歳 |\n| 職業 | 動画配信者 |\n| 機材 | ジンバル |\n',
    );
    const registry = createProjectRegistry({
      repoPath: fixtureRoot,
      fetchImpl: async () => new Response(tinyPng(), { status: 200, headers: { 'content-type': 'image/png' } }),
    });
    const adopted = await registry.adoptAnchor({
      project_id: 'bottom-of-thirst',
      subject_id: 'kamino_kyosuke',
      candidate_file: { download_url: 'https://files.example.test/kyosuke.png', file_id: 'file-kyosuke' },
      approval: 'approve',
    });

    const packageResult = await registry.resolve('bottom-of-thirst').prepare({
      project_id: 'bottom-of-thirst',
      asset_type: 'character_portrait',
      subject_ids: ['kamino_kyosuke'],
      request_text: '神野恭介の通常立ち絵',
    });
    expect(adopted.anchor_path).toBe('public/images/characters/kamino_kyosuke/v2/default.png');
    expect(packageResult.policy.must_use_approved_anchor).toBe(true);
    expect(packageResult.reference_assets).toContainEqual({
      role: 'subject_anchor',
      subject_id: 'kamino_kyosuke',
      path: adopted.anchor_path,
    });
  });

  it('does not interpret ChatGPT paths as local paths and rejects ambiguous inputs', async () => {
    const registry = createProjectRegistry({
      projectsConfigPath: path.join(fixtureRoot, 'projects.json'),
      fetchImpl: async () => new Response(tinyPng(), { status: 200, headers: { 'content-type': 'image/png' } }),
    });
    await expect(registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'hero',
      candidate_file: { download_url: 'file:///mnt/data/foo.png', file_id: 'file-local-path' },
      approval: 'approve',
    })).rejects.toMatchObject({ code: 'FILE_DOWNLOAD_URL_INVALID' });
    await expect(registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'hero',
      candidate_file: { download_url: 'https://files.example.test/foo.png', file_id: 'file-both' },
      candidate_path: 'assets/hero/candidate.png',
      approval: 'approve',
    })).rejects.toMatchObject({ code: 'AMBIGUOUS_CANDIDATE_INPUT' });
  });

  it('rolls back the downloaded image when Canon replacement fails', async () => {
    const destination = path.join(fixtureRoot, 'public/images/characters/hero/v2/default.png');
    const canonPath = path.join(fixtureRoot, 'docs/visual/CHARACTER_VISUAL_CANON.md');
    const originalCanon = await readFile(canonPath, 'utf8');
    const registry = createProjectRegistry({
      projectsConfigPath: path.join(fixtureRoot, 'projects.json'),
      fetchImpl: async () => new Response(tinyPng(), { status: 200, headers: { 'content-type': 'image/png' } }),
      replaceCanonFile: async () => {
        throw new VisualDirectorError('CANON_WRITE_FAILED', 'simulated Canon write failure');
      },
    });

    await expect(registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'hero',
      candidate_file: { download_url: 'https://files.example.test/foo.png', file_id: 'file-rollback' },
      approval: 'approve',
    })).rejects.toMatchObject({ code: 'CANON_WRITE_FAILED' });
    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(canonPath, 'utf8')).resolves.toBe(originalCanon);
  });

  it('does not update Canon when the destination cannot be written', async () => {
    const destination = path.join(fixtureRoot, 'public/images/characters/hero/v2/default.png');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, tinyPng());
    const canonPath = path.join(fixtureRoot, 'docs/visual/CHARACTER_VISUAL_CANON.md');
    const originalCanon = await readFile(canonPath, 'utf8');
    const registry = createProjectRegistry({
      projectsConfigPath: path.join(fixtureRoot, 'projects.json'),
      fetchImpl: async () => new Response(tinyPng(), { status: 200, headers: { 'content-type': 'image/png' } }),
    });

    await expect(registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'hero',
      candidate_file: { download_url: 'https://files.example.test/foo.png', file_id: 'file-destination-conflict' },
      approval: 'approve',
    })).rejects.toMatchObject({ code: 'ANCHOR_DESTINATION_CONFLICT' });
    await expect(readFile(canonPath, 'utf8')).resolves.toBe(originalCanon);
  });

  it('fails closed for unknown inputs, non-images, MIME mismatches, and file Anchor conflicts', async () => {
    const registry = createProjectRegistry({
      projectsConfigPath: path.join(fixtureRoot, 'projects.json'),
      fetchImpl: async () => new Response(tinyPng(), { status: 200, headers: { 'content-type': 'image/png' } }),
    });
    await expect(registry.adoptAnchor({
      project_id: 'unknown',
      subject_id: 'hero',
      candidate_path: 'assets/hero/candidate.png',
      approval: 'approve',
    })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    await expect(registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'unknown',
      candidate_path: 'assets/hero/candidate.png',
      approval: 'approve',
    })).rejects.toMatchObject({ code: 'SUBJECT_NOT_FOUND' });
    await expect(registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'hero',
      candidate_path: 'assets/hero/candidate.png',
      approval: 'reject' as never,
    })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    await writeFile(path.join(fixtureRoot, 'assets/hero/broken.png'), 'not an image');
    await expect(registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'hero',
      candidate_path: 'assets/hero/broken.png',
      approval: 'approve',
    })).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'hero',
      candidate_file: { download_url: 'https://files.example.test/mismatch.png', file_id: 'file-mismatch', mime_type: 'image/jpeg' },
      approval: 'approve',
    })).rejects.toMatchObject({ code: 'IMAGE_MIME_MISMATCH' });

    await registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'hero',
      candidate_path: 'assets/hero/candidate.png',
      approval: 'approve',
    });
    await expect(registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'hero',
      candidate_file: { download_url: 'https://files.example.test/conflict.png', file_id: 'file-conflict' },
      approval: 'approve',
    })).rejects.toMatchObject({ code: 'APPROVED_ANCHOR_CONFLICT' });
  });

  it('preserves CRLF when adding the Canon entry', () => {
    const source = '# Canon\r\n\r\n## Hero\r\n\r\n### State\r\n- pending\r\n';
    const result = registerApprovedAnchor(source, 'Hero', 'assets/hero/default.avif');
    expect(result).not.toMatch(/(?<!\r)\n/);
  });
});

function tinyPng(): Buffer {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
}

function tinyJpeg(): Buffer {
  return Buffer.from('FFD8FFC00011080001000103011100021100031100FFDA000C03010002110311003F00FFD9', 'hex');
}
