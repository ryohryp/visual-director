import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prepareRequiredAssetGeneration } from '../src/core/required-asset-generation.js';
import { createVisualDirectorCore } from '../src/core/visual-director.js';
import type { ImageGenerator } from '../src/generators/types.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'visual-director-required-generation-'));
  await createFixture(root);
  await writePlan(root, {
    version: 1,
    scan: { roots: [], ignore: [] },
    assets: [requiredAsset()],
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Required Asset generation preparation', () => {
  it('builds deterministic generation input from a MISSING Required Asset and reuses Canon preparation', async () => {
    const core = createVisualDirectorCore();
    const prepared = await prepareRequiredAssetGeneration(core, {
      project_id: 'bottom-of-thirst',
      required_asset_id: 'chapter1-archive-cg',
      repository_path: root,
    });

    expect(prepared).toMatchObject({
      project_id: 'bottom-of-thirst',
      required_asset_id: 'chapter1-archive-cg',
      production_path: 'public/images/events/chapter1-archive.webp',
      generation_input: {
        project_id: 'bottom-of-thirst',
        required_asset_id: 'chapter1-archive-cg',
        asset_type: 'event_cg',
        subject_ids: ['souma'],
        request_text: '地下の記録保管庫で古い記録を確認しているイベントCG',
        scene_context: {
          aspect_ratio: '16:9',
          requirements: ['中央の人物と記録簿が9:16 cropでも読める'],
        },
      },
      execution: {
        mode: 'prepare_only',
        candidate_generation_started: false,
        next_tool: 'visual.generate_image',
      },
    });
    expect(prepared.generation_input.scene_context).not.toHaveProperty('repository_path');
    expect(prepared.generation_package.reference_assets).toContainEqual({
      role: 'subject_anchor',
      subject_id: 'souma',
      path: 'public/images/characters/souma/v2/default.avif',
    });
    expect(prepared.generation_package.policy).toMatchObject({
      must_use_approved_anchor: true,
      must_not_chain_from_candidate: true,
      must_review_after_generation: true,
    });
  });

  it('fails closed when generation.request is missing', async () => {
    await writePlan(root, {
      version: 1,
      scan: { roots: [], ignore: [] },
      assets: [requiredAsset({
        generation: {
          requirements: ['request is intentionally missing'],
        },
      })],
    });

    await expect(prepareRequiredAssetGeneration(createVisualDirectorCore(), {
      project_id: 'bottom-of-thirst',
      required_asset_id: 'chapter1-archive-cg',
      repository_path: root,
    })).rejects.toMatchObject({ code: 'REQUIRED_ASSET_GENERATION_INCOMPLETE' });
  });

  it('does not offer the generation path to optional assets', async () => {
    await writePlan(root, {
      version: 1,
      scan: { roots: [], ignore: [] },
      assets: [requiredAsset({ required: false })],
    });

    await expect(prepareRequiredAssetGeneration(createVisualDirectorCore(), {
      project_id: 'bottom-of-thirst',
      required_asset_id: 'chapter1-archive-cg',
      repository_path: root,
    })).rejects.toMatchObject({ code: 'REQUIRED_ASSET_GENERATION_NOT_ELIGIBLE' });
  });

  it('rejects a second preparation when an active job already targets the Required Asset', async () => {
    await writeWorkflow(root, {
      jobs: [{
        job_id: 'job-existing',
        required_asset_id: 'chapter1-archive-cg',
        asset_type: 'event_cg',
        subject_ids: ['souma'],
        request_text: 'already running',
        status: 'generating',
      }],
      assets: [],
    });

    await expect(prepareRequiredAssetGeneration(createVisualDirectorCore(), {
      project_id: 'bottom-of-thirst',
      required_asset_id: 'chapter1-archive-cg',
      repository_path: root,
    })).rejects.toMatchObject({
      code: 'REQUIRED_ASSET_GENERATION_IN_PROGRESS',
      details: { job_id: 'job-existing', status: 'generating' },
    });
  });

  it('flows from MISSING to REVIEW_REQUIRED through the existing isolated generation workflow', async () => {
    const generator: ImageGenerator = {
      id: 'fake:required-asset',
      async generate() {
        return {
          bytes: Buffer.from('candidate-image'),
          mime_type: 'image/webp',
          extension: 'webp',
          generator: 'fake:required-asset',
        };
      },
    };
    const core = createVisualDirectorCore({ imageGenerator: generator });
    const prepared = await prepareRequiredAssetGeneration(core, {
      project_id: 'bottom-of-thirst',
      required_asset_id: 'chapter1-archive-cg',
      repository_path: root,
    });

    await core.generateImage({
      ...prepared.generation_input,
      repository_path: root,
      job_id: 'job-required-001',
      asset_id: 'candidate-required-001',
    });

    const overview = await core.getProjectVisualOverview({ project_id: 'bottom-of-thirst', repository_path: root });
    expect(overview.inventory.assets.find((asset) => asset.asset_id === 'chapter1-archive-cg')).toMatchObject({
      status: 'REVIEW_REQUIRED',
      candidate_path: '.visual-director/candidates/job-required-001/candidate-required-001.webp',
    });
    const index = JSON.parse(await readFile(path.join(root, '.visual-director/asset-index.json'), 'utf8')) as {
      jobs: Array<{ required_asset_id?: string }>;
      assets: Array<{ required_asset_id?: string }>;
    };
    expect(index.jobs[0]?.required_asset_id).toBe('chapter1-archive-cg');
    expect(index.assets[0]?.required_asset_id).toBe('chapter1-archive-cg');
  });

  it('prevents duplicate required-asset jobs even when callers use different workflow IDs', async () => {
    let generationCalls = 0;
    const generator: ImageGenerator = {
      id: 'fake:duplicate-guard',
      async generate() {
        generationCalls += 1;
        return {
          bytes: Buffer.from(`candidate-${generationCalls}`),
          mime_type: 'image/webp',
          extension: 'webp',
          generator: 'fake:duplicate-guard',
        };
      },
    };
    const core = createVisualDirectorCore({ imageGenerator: generator });
    const request = {
      project_id: 'bottom-of-thirst',
      repository_path: root,
      required_asset_id: 'chapter1-archive-cg',
      asset_type: 'event_cg',
      subject_ids: ['souma'],
      request_text: '地下の記録保管庫で古い記録を確認しているイベントCG',
      scene_context: { aspect_ratio: '16:9' },
    };

    await core.generateImage({ ...request, job_id: 'job-first', asset_id: 'asset-first' });
    await expect(core.generateImage({ ...request, job_id: 'job-second', asset_id: 'asset-second' }))
      .rejects.toMatchObject({ code: 'WORKFLOW_REQUIRED_ASSET_CONFLICT' });
    expect(generationCalls).toBe(1);
  });
});

function requiredAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asset_id: 'chapter1-archive-cg',
    asset_type: 'event_cg',
    title: '第一章・記録保管庫',
    usage: 'chapter1 event CG',
    production_path: 'public/images/events/chapter1-archive.webp',
    subject_ids: ['souma'],
    required: true,
    generation: {
      aspect_ratio: '16:9',
      request: '地下の記録保管庫で古い記録を確認しているイベントCG',
      requirements: ['中央の人物と記録簿が9:16 cropでも読める'],
    },
    ...overrides,
  };
}

async function writePlan(repo: string, plan: unknown): Promise<void> {
  const target = path.join(repo, '.visual-director/asset-plan.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(plan, null, 2), 'utf8');
}

async function writeWorkflow(repo: string, workflow: unknown): Promise<void> {
  const target = path.join(repo, '.visual-director/asset-index.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(workflow, null, 2), 'utf8');
}

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
  };
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(repo, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents);
  }
}
