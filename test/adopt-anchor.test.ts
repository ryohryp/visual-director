import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
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
      const adoptTool = (await client.listTools()).tools.find((tool) => tool.name === 'visual.adopt_anchor');
      expect(adoptTool).toMatchObject({
        name: 'visual.adopt_anchor',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      });
      expect(adoptTool?._meta).toMatchObject({ 'openai/fileParams': ['candidate_file'] });

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
          project_id: 'game', subject_id: 'hero', candidate_path: 'assets/hero/candidate.png', approval: 'approve',
        },
      });
      expect(repeated.isError).not.toBe(true);
      expect(repeated.structuredContent).toMatchObject({ changed: false });

      const prepared = await client.callTool({
        name: 'visual.prepare_generation',
        arguments: {
          project_id: 'game', asset_type: 'character_portrait', subject_ids: ['hero'], request_text: 'Use the adopted Hero Anchor.',
        },
      });
      expect(prepared.isError).not.toBe(true);
      expect(prepared.structuredContent).toMatchObject({
        project_id: 'game',
        policy: { must_use_approved_anchor: true, must_not_chain_from_candidate: true },
        reference_assets: [
          { role: 'global_reference', path: 'docs/visual/assets/global_visual_style_reference.webp' },
          { role: 'subject_anchor', subject_id: 'hero', path: 'assets/hero/candidate.png' },
        ],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('registers an explicitly approved repository candidate and is idempotent', async () => {
    const registry = createProjectRegistry({ projectsConfigPath: path.join(fixtureRoot, 'projects.json') });
    const input = {
      project_id: 'game', subject_id: 'hero', candidate_path: 'assets/hero/candidate.png', approval: 'approve' as const,
    };
    await expect(registry.adoptAnchor(input)).resolves.toMatchObject({ subject_id: 'hero', changed: true });
    await expect(registry.adoptAnchor(input)).resolves.toMatchObject({ changed: false });
    const canon = await readFile(path.join(fixtureRoot, 'docs/visual/CHARACTER_VISUAL_CANON.md'), 'utf8');
    expect(canon.match(/### Approved Visual Anchor/g)).toHaveLength(1);
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

  it('downloads ChatGPT file references and keeps prepare_generation on the adopted Anchor', async () => {
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
    expect(adopted).toMatchObject({
      anchor_path: 'public/images/characters/hero/v2/default.jpg',
      mime_type: 'image/jpeg',
      width: 1,
      height: 1,
      changed: true,
    });
    const packageResult = await registry.resolve('game').prepare({
      project_id: 'game', asset_type: 'character_portrait', subject_ids: ['hero'], request_text: 'The Hero portrait',
    });
    expect(packageResult.reference_assets).toContainEqual({
      role: 'subject_anchor', subject_id: 'hero', path: adopted.anchor_path,
    });
  });

  it('fails closed for invalid project state, subjects, approval and image inputs', async () => {
    const registry = createProjectRegistry({
      projectsConfigPath: path.join(fixtureRoot, 'projects.json'),
      fetchImpl: async () => new Response(tinyPng(), { status: 200, headers: { 'content-type': 'image/png' } }),
    });
    await expect(registry.adoptAnchor({
      project_id: 'unknown', subject_id: 'hero', candidate_path: 'assets/hero/candidate.png', approval: 'approve',
    })).rejects.toMatchObject({ code: 'PROJECT_CONFIG_MISSING' });
    await expect(registry.adoptAnchor({
      project_id: 'game', subject_id: 'unknown', candidate_path: 'assets/hero/candidate.png', approval: 'approve',
    })).rejects.toMatchObject({ code: 'SUBJECT_NOT_FOUND' });
    await expect(registry.adoptAnchor({
      project_id: 'game', subject_id: 'hero', candidate_path: 'assets/hero/candidate.png', approval: 'reject' as never,
    })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    await writeFile(path.join(fixtureRoot, 'assets/hero/broken.png'), 'not an image');
    await expect(registry.adoptAnchor({
      project_id: 'game', subject_id: 'hero', candidate_path: 'assets/hero/broken.png', approval: 'approve',
    })).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(registry.adoptAnchor({
      project_id: 'game',
      subject_id: 'hero',
      candidate_file: { download_url: 'https://files.example.test/mismatch.png', file_id: 'file-mismatch', mime_type: 'image/jpeg' },
      approval: 'approve',
    })).rejects.toMatchObject({ code: 'IMAGE_MIME_MISMATCH' });
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
      project_id: 'game', subject_id: 'hero', candidate_file: { download_url: 'https://files.example.test/foo.png', file_id: 'file-rollback' }, approval: 'approve',
    })).rejects.toMatchObject({ code: 'CANON_WRITE_FAILED' });
    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(canonPath, 'utf8')).resolves.toBe(originalCanon);
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
