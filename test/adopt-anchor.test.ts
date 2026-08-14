import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createVisualDirectorServer } from '../src/mcp/server.js';
import { createProjectRegistry, registerApprovedAnchor } from '../src/projects/registry.js';

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-director-adopt-anchor-'));
  await mkdir(path.join(fixtureRoot, 'docs/visual/assets'), { recursive: true });
  await mkdir(path.join(fixtureRoot, 'docs/characters'), { recursive: true });
  await mkdir(path.join(fixtureRoot, 'assets/hero'), { recursive: true });
  await writeFile(path.join(fixtureRoot, 'docs/visual/CHARACTER_VISUAL_CANON.md'), '# Canon\n\n## The Hero\n\n### Canonical state model\n- pending_anchor\n');
  await writeFile(path.join(fixtureRoot, 'assets/hero/candidate.avif'), 'candidate');
  await writeFile(path.join(fixtureRoot, 'projects.json'), JSON.stringify({
    projects: {
      game: {
        repo_path: '.',
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
      expect(tools.tools.find((tool) => tool.name === 'visual.adopt_anchor')).toMatchObject({
        name: 'visual.adopt_anchor',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      });

      const result = await client.callTool({
        name: 'visual.adopt_anchor',
        arguments: {
          project_id: 'game',
          subject_id: 'hero',
          candidate_path: 'assets/hero/candidate.avif',
          approval: 'approve',
        },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        project_id: 'game',
        subject_id: 'hero',
        approved_anchor_path: 'assets/hero/candidate.avif',
        canon_path: 'docs/visual/CHARACTER_VISUAL_CANON.md',
        changed: true,
      });

      const repeated = await client.callTool({
        name: 'visual.adopt_anchor',
        arguments: {
          project_id: 'game',
          subject_id: 'hero',
          candidate_path: 'assets/hero/candidate.avif',
          approval: 'approve',
        },
      });
      expect(repeated.isError).not.toBe(true);
      expect(repeated.structuredContent).toMatchObject({ changed: false });
    } finally {
      await client.close();
      await server.close();
    }

    const canon = await readFile(path.join(fixtureRoot, 'docs/visual/CHARACTER_VISUAL_CANON.md'), 'utf8');
    expect(canon).toContain('### Approved Visual Anchor\n- `assets/hero/candidate.avif`');
  });

  it('registers an explicitly approved repository candidate and is idempotent', async () => {
    const registry = createProjectRegistry({ projectsConfigPath: path.join(fixtureRoot, 'projects.json') });
    const input = {
      project_id: 'game',
      subject_id: 'hero',
      candidate_path: 'assets/hero/candidate.avif',
      approval: 'approve' as const,
    };

    await expect(registry.adoptAnchor(input)).resolves.toMatchObject({
      subject_id: 'hero',
      approved_anchor_path: 'assets/hero/candidate.avif',
      changed: true,
    });
    await expect(registry.adoptAnchor(input)).resolves.toMatchObject({ changed: false });
    const canon = await readFile(path.join(fixtureRoot, 'docs/visual/CHARACTER_VISUAL_CANON.md'), 'utf8');
    expect(canon.match(/### Approved Visual Anchor/g)).toHaveLength(1);
    expect(canon).toContain('- `assets/hero/candidate.avif`');
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
      project_id: 'game', subject_id: 'hero', candidate_path: 'assets/hero/candidate.avif', approval: 'approve',
    });
    await writeFile(path.join(fixtureRoot, 'assets/hero/other.avif'), 'other');
    await expect(registry.adoptAnchor({
      project_id: 'game', subject_id: 'hero', candidate_path: 'assets/hero/other.avif', approval: 'approve',
    })).rejects.toMatchObject({ code: 'APPROVED_ANCHOR_CONFLICT' });
  });

  it('preserves CRLF when adding the Canon entry', () => {
    const source = '# Canon\r\n\r\n## Hero\r\n\r\n### State\r\n- pending\r\n';
    const result = registerApprovedAnchor(source, 'Hero', 'assets/hero/default.avif');
    expect(result).not.toMatch(/(?<!\r)\n/);
  });
});
