import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createVisualDirectorCore } from '../src/core/visual-director.js';
import { OpenAIImageGenerator } from '../src/generators/openai-image-generator.js';
import type { ImageGenerator } from '../src/generators/types.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'visual-director-generation-'));
  await createFixture(root);
});

afterEach(async () => {
  delete process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY;
  await rm(root, { recursive: true, force: true });
});

describe('image generation orchestration', () => {
  it('prepares from Canon, invokes one generator, and registers only a Candidate', async () => {
    const generator: ImageGenerator = {
      id: 'fake:image-v1',
      async generate(input) {
        expect(input.generation_package.reference_assets).toEqual([
          { role: 'global_reference', path: 'docs/visual/assets/global_visual_style_reference.webp' },
          { role: 'subject_anchor', subject_id: 'souma', path: 'public/images/characters/souma/v2/default.avif' },
        ]);
        expect(input.prompt).toContain('STYLE LOCK');
        expect(input.prompt).toContain('Approved Visual Anchor');
        expect(input.size).toBe('1024x1536');
        return {
          bytes: Buffer.from('generated-image'),
          mime_type: 'image/webp',
          extension: 'webp',
          generator: 'fake:image-v1',
        };
      },
    };
    const core = createVisualDirectorCore({ imageGenerator: generator });
    const result = await core.generateImage({
      project_id: 'bottom-of-thirst',
      repository_path: root,
      job_id: 'job-001',
      asset_id: 'asset-001',
      asset_type: 'event_cg',
      subject_ids: ['souma'],
      request_text: '地下の記録保管庫で古い記録を確認しているイベントCG',
      scene_context: { location: '地下の記録保管庫' },
    });

    expect(result).toMatchObject({
      status: 'candidate',
      generator: 'fake:image-v1',
      candidate_path: '.visual-director/candidates/job-001/asset-001.webp',
    });
    expect(result.generation_package_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(path.join(root, result.candidate_path), 'utf8')).toBe('generated-image');

    const index = JSON.parse(await readFile(path.join(root, '.visual-director/asset-index.json'), 'utf8')) as {
      jobs: Array<{ status: string; error?: string }>;
      assets: Array<{ status: string; reference_paths: string[]; generation_package_fingerprint?: string }>;
    };
    expect(index.jobs[0]?.status).toBe('candidate');
    expect(index.jobs[0]?.error).toBeUndefined();
    expect(index.assets[0]).toMatchObject({
      status: 'candidate',
      reference_paths: [
        'docs/visual/assets/global_visual_style_reference.webp',
        'public/images/characters/souma/v2/default.avif',
      ],
      generation_package_fingerprint: result.generation_package_fingerprint,
    });
  });

  it('uses a landscape generator canvas for a background whose primary composition is 16:9', async () => {
    let observedSize: string | undefined;
    const generator: ImageGenerator = {
      id: 'fake:landscape',
      async generate(input) {
        observedSize = input.size;
        return {
          bytes: Buffer.from('landscape-image'),
          mime_type: 'image/webp',
          extension: 'webp',
          generator: 'fake:landscape',
        };
      },
    };
    const core = createVisualDirectorCore({ imageGenerator: generator });

    await core.generateImage({
      project_id: 'bottom-of-thirst',
      repository_path: root,
      job_id: 'job-background',
      asset_id: 'asset-background',
      asset_type: 'background_replacement_pair',
      subject_ids: ['souma'],
      request_text: '図書館背景を生成する',
      scene_context: { composition: '16:9 primary composition with a centered 9:16 crop' },
    });

    expect(observedSize).toBe('1536x1024');
  });

  it('forwards the resolved landscape canvas to the OpenAI generator request', async () => {
    let observedSize: FormDataEntryValue | null = null;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData);
      observedSize = (init?.body as FormData).get('size');
      return new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from('openai-generated-image').toString('base64') }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const core = createVisualDirectorCore({
      imageGenerator: new OpenAIImageGenerator({ apiKey: 'test-key', fetchImpl }),
    });

    await core.generateImage({
      project_id: 'bottom-of-thirst',
      repository_path: root,
      job_id: 'job-openai-background',
      asset_id: 'asset-openai-background',
      asset_type: 'background',
      subject_ids: ['souma'],
      request_text: '横長の背景を生成する',
      scene_context: { aspect_ratio: '16:9' },
    });

    expect(observedSize).toBe('1536x1024');
  });

  it('persists an explicit failed job when the generator fails', async () => {
    const generator: ImageGenerator = {
      id: 'fake:failing',
      async generate() {
        throw new Error('provider unavailable');
      },
    };
    const core = createVisualDirectorCore({ imageGenerator: generator });

    await expect(core.generateImage({
      project_id: 'bottom-of-thirst',
      repository_path: root,
      job_id: 'job-fail',
      asset_id: 'asset-fail',
      asset_type: 'event_cg',
      subject_ids: ['souma'],
      request_text: '生成失敗を記録する',
    })).rejects.toMatchObject({ code: 'GENERATOR_FAILED' });

    const index = JSON.parse(await readFile(path.join(root, '.visual-director/asset-index.json'), 'utf8')) as {
      jobs: Array<{ status: string; error?: string }>;
      assets: unknown[];
    };
    expect(index.jobs[0]).toMatchObject({ status: 'failed', error: 'provider unavailable' });
    expect(index.assets).toEqual([]);
  });

  it('keeps generation disabled in hosted read-only mode', async () => {
    process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY = '1';
    const core = createVisualDirectorCore({
      imageGenerator: {
        id: 'fake',
        async generate() {
          throw new Error('must not run');
        },
      },
    });

    await expect(core.generateImage({
      project_id: 'bottom-of-thirst',
      repository_path: root,
      job_id: 'job-hosted',
      asset_id: 'asset-hosted',
      asset_type: 'event_cg',
      subject_ids: ['souma'],
      request_text: 'hosted write is disabled',
    })).rejects.toMatchObject({ code: 'HOSTED_WRITE_DISABLED' });
  });
});

async function createFixture(repo: string): Promise<void> {
  const files: Record<string, string | Buffer> = {
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
      },
    }),
    'docs/visual/GLOBAL_VISUAL_STYLE.md': `# Global Style\n\n## Global Visual Style Lock\n\n\`\`\`text\nSTYLE LOCK\n\`\`\`\n\n## Fixed Avoid Block\n\n\`\`\`text\nAVOID: photorealism, anime\n\`\`\`\n\n### 変更してよいもの\n- small facial expression\n\n### 変更してはいけないもの\n- face identity\n`,
    'docs/visual/CHARACTER_VISUAL_CANON.md': `# Canon\n\n## 共通ルール\n- Always use an approved anchor.\n\n## 相馬 健人\n\n### Approved Visual Anchor\n- \`public/images/characters/souma/v2/default.avif\`\n\n### 採用する視覚条件\n- 32歳の契約記者\n`,
    'docs/WORLD_DIRECTION.md': '# World\n\n- grounded and observational\n',
    'docs/characters/soma.md': '# Soma\n\n- contract reporter\n',
    'docs/visual/assets/README.md': '# Assets\n',
    'docs/visual/assets/global_visual_style_reference.webp': Buffer.from('global'),
    'public/images/characters/souma/v2/default.avif': Buffer.from('anchor'),
    'public/images/characters/souma/v2/default.webp': Buffer.from('anchor-webp'),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(repo, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents);
  }
}
