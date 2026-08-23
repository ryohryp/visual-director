import { afterEach, describe, expect, it, vi } from 'vitest';

import { adoptHostedApprovedAnchor } from '../src/mcp/hosted-anchor-adoption.js';
import type { RepositoryTextWrite } from '../src/projects/github-repository-writer.js';
import type { RepositorySource } from '../src/projects/repository-source.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGPkEpFjYGAAAAEmAD5j+GBZAAAAAElFTkSuQmCC';
const PNG_SHA256 = '33135cdb46b55276d616f81ee83c01cd2cf07e3af536f5cf137abc5d489e9810';
const MANIFEST_PATH = 'docs/assets/player-unarmed-approved-anchor-v0.3.json';
const ANCHOR_PATH = 'docs/assets/player-unarmed-approved-anchor-v0.3.png';
const CANON_PATH = 'docs/visual/CHARACTER_VISUAL_CANON.md';

const previousWriteToken = process.env.VISUAL_DIRECTOR_GITHUB_WRITE_TOKEN;
afterEach(() => {
  if (previousWriteToken === undefined) delete process.env.VISUAL_DIRECTOR_GITHUB_WRITE_TOKEN;
  else process.env.VISUAL_DIRECTOR_GITHUB_WRITE_TOKEN = previousWriteToken;
});

describe('hosted Approved Anchor adoption', () => {
  it('returns an explicit approved no-op when repository Canon already has the verified Anchor', async () => {
    const source = crownlessSource({ currentAnchor: ANCHOR_PATH });
    const writer = { commitTextFiles: vi.fn() };

    const result = await adoptHostedApprovedAnchor(adoptionInput(), {
      source,
      fetchImpl: approvedFileFetch,
      writer,
    });

    expect(result).toEqual({
      project_id: 'crownless',
      subject_id: 'player-unarmed',
      status: 'approved',
      anchor_path: ANCHOR_PATH,
      approved_anchor_path: ANCHOR_PATH,
      canon_path: CANON_PATH,
      changed: false,
      sha256: PNG_SHA256,
      mime_type: 'image/png',
      width: 2,
      height: 1,
    });
    expect(writer.commitTextFiles).not.toHaveBeenCalled();
  });

  it('writes only Character Canon and compiled Canon when a verified subject needs adoption', async () => {
    const source = crownlessSource({ currentAnchor: null });
    const commitTextFiles = vi.fn(async (files: readonly RepositoryTextWrite[]) => ({
      commit_sha: 'commit-sha',
      ref: 'main',
      changed_paths: files.map((file) => file.path),
    }));

    const result = await adoptHostedApprovedAnchor(adoptionInput(), {
      source,
      fetchImpl: approvedFileFetch,
      writer: { commitTextFiles },
    });

    expect(result.changed).toBe(true);
    expect(commitTextFiles).toHaveBeenCalledTimes(1);
    const [files] = commitTextFiles.mock.calls[0] as unknown as [RepositoryTextWrite[]];
    expect(files.map((file) => file.path)).toEqual([
      CANON_PATH,
      '.visual-director/compiled-canon.json',
    ]);
    expect(files[0]?.content).toContain(`- \`${ANCHOR_PATH}\``);
    expect(files[0]?.content).toContain('## 敵：Rusher');
    const compiled = JSON.parse(files[1]?.content ?? '{}') as { subjects?: Array<{ subject_id?: string; approved_anchor_path?: string }> };
    expect(compiled.subjects).toContainEqual(expect.objectContaining({
      subject_id: 'player-unarmed',
      approved_anchor_path: ANCHOR_PATH,
    }));
  });

  it('rejects a manifest scoped to another subject before any write', async () => {
    const source = crownlessSource({ currentAnchor: ANCHOR_PATH, manifestSubject: 'enemy-rusher' });
    const writer = { commitTextFiles: vi.fn() };

    await expect(adoptHostedApprovedAnchor(adoptionInput(), {
      source,
      fetchImpl: approvedFileFetch,
      writer,
    })).rejects.toMatchObject({ code: 'APPROVED_ANCHOR_SCOPE_MISMATCH' });
    expect(writer.commitTextFiles).not.toHaveBeenCalled();
  });

  it('rejects source bytes whose SHA does not match the Approved Candidate manifest', async () => {
    const source = crownlessSource({ currentAnchor: ANCHOR_PATH, generationSha: '0'.repeat(64) });

    await expect(adoptHostedApprovedAnchor(adoptionInput(), {
      source,
      fetchImpl: approvedFileFetch,
    })).rejects.toMatchObject({ code: 'APPROVED_SOURCE_SHA_MISMATCH' });
  });

  it('reports write capability separately after validation when persistence is required', async () => {
    delete process.env.VISUAL_DIRECTOR_GITHUB_WRITE_TOKEN;
    const source = crownlessSource({ currentAnchor: null });

    await expect(adoptHostedApprovedAnchor(adoptionInput(), {
      source,
      fetchImpl: approvedFileFetch,
    })).rejects.toMatchObject({
      code: 'HOSTED_ANCHOR_WRITE_UNAVAILABLE',
      message: expect.stringContaining('validated'),
    });
  });
});

function adoptionInput() {
  return {
    project_id: 'crownless',
    subject_id: 'player-unarmed',
    candidate_path: MANIFEST_PATH,
    candidate_file: {
      download_url: 'https://files.example.test/player-unarmed.png',
      file_id: 'file-player-unarmed-v03',
      mime_type: 'image/png',
      file_name: 'player-unarmed-approved-anchor-v0.3.png',
    },
    approval: 'approve' as const,
  };
}

function crownlessSource(options: {
  currentAnchor: string | null;
  manifestSubject?: string;
  generationSha?: string;
}): RepositorySource {
  const text = new Map<string, string>([
    ['.visual-director/manifest.json', JSON.stringify({
      version: 1,
      project_id: 'crownless',
      documents: {
        grandDesign: '.visual-director/grand-design.json',
        globalStyle: 'docs/visual/GLOBAL_VISUAL_STYLE.md',
        characterCanon: CANON_PATH,
        worldDirection: 'docs/visual/WORLD_DIRECTION.md',
        assetManifest: 'docs/assets/README.md',
        globalReference: 'docs/assets/crownless-visual-design-reference-v0.1.jpg',
      },
      labels: {
        avoidBlockHeading: 'Fixed Avoid Block',
        allowedChangesHeading: 'Allowed Changes',
        forbiddenChangesHeading: 'Forbidden Changes',
        commonRulesHeading: 'Common rules',
        acceptedConditionsHeading: 'Accepted visual conditions',
      },
      subjects: {
        'player-unarmed': {
          display_name: '素手の主人公',
          character_file: CANON_PATH,
          canon_heading: '素手の主人公',
        },
        'enemy-rusher': {
          display_name: '敵：Rusher',
          character_file: CANON_PATH,
          canon_heading: '敵：Rusher',
        },
      },
    })],
    ['.visual-director/grand-design.json', JSON.stringify({
      schema_version: 1,
      project_id: 'crownless',
      visual_dna: 'Crownless Grand Design',
      shared_rules: { manuscript_density: true },
      fixed_avoid: ['photorealism'],
      asset_types: { background: { purpose: 'silhouette-first readability' } },
    })],
    ['docs/visual/GLOBAL_VISUAL_STYLE.md', '# Crownless Global Visual Style\n\n## Global Visual Style Lock\n\n```text\nCrownless manuscript style lock\n```\n\n## Fixed Avoid Block\n\n```text\nAVOID: photorealism\n```\n\n### Allowed Changes\n- Pose may vary within canon.\n\n### Forbidden Changes\n- Do not drift.\n'],
    [CANON_PATH, characterCanon(options.currentAnchor)],
    ['docs/visual/WORLD_DIRECTION.md', '- Medieval fantasy world direction.\n'],
    ['docs/assets/README.md', '# Assets\n'],
    [MANIFEST_PATH, JSON.stringify({
      candidate_id: 'player_unarmed_approved_anchor_v0.3',
      asset_type: 'character_visual_anchor',
      project_id: 'crownless',
      subject_id: options.manifestSubject ?? 'player-unarmed',
      status: 'approved_candidate',
      generation: {
        generation_id: 'test-generation',
        original_dimensions: [2, 1],
        original_sha256: options.generationSha ?? PNG_SHA256,
      },
      source: {
        path: ANCHOR_PATH,
        dimensions: [2, 1],
        sha256: PNG_SHA256,
        mime_type: 'image/png',
      },
    })],
  ]);
  const binary = new Set([
    ANCHOR_PATH,
    'docs/assets/crownless-visual-design-reference-v0.1.jpg',
    'docs/assets/enemy-rusher.png',
  ]);
  return {
    kind: 'github',
    checkAccess: vi.fn(async () => undefined),
    readText: vi.fn(async (relativePath: string) => {
      const value = text.get(relativePath);
      if (value === undefined) throw new Error(`missing fixture: ${relativePath}`);
      return value;
    }),
    ensureFile: vi.fn(async (relativePath: string) => {
      if (!text.has(relativePath) && !binary.has(relativePath)) throw new Error(`missing fixture: ${relativePath}`);
    }),
    fileExists: vi.fn(async (relativePath: string) => text.has(relativePath) || binary.has(relativePath)),
  };
}

function characterCanon(currentAnchor: string | null): string {
  return `# Crownless Character Visual Canon\n\n## Common rules\n- Keep compact folk-doll proportions.\n\n## 素手の主人公\n${currentAnchor ? `\n### Approved Visual Anchor\n\n- \`${currentAnchor}\`\n` : ''}\n### Accepted visual conditions\n- anonymous unknown survivor\n- intentionally unarmed\n\n## 敵：Rusher\n\n### Approved Visual Anchor\n\n- \`docs/assets/enemy-rusher.png\`\n\n### Accepted visual conditions\n- aggressive forward silhouette\n`;
}

async function approvedFileFetch(): Promise<Response> {
  const bytes = Buffer.from(PNG_BASE64, 'base64');
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-length': String(bytes.byteLength),
    },
  });
}
