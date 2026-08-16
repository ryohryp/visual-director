import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createVisualDirectorCore } from '../src/core/visual-director.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'visual-director-workflow-'));
  await writeRepoFile('.visual-director/manifest.json', JSON.stringify({
    version: 1,
    project_id: 'bottom-of-thirst',
    subjects: {},
  }));
  await writeRepoFile('.visual-director/candidates/gen-1/candidate.webp', 'candidate');
  await writeRepoFile('docs/visual/assets/global.webp', 'reference');
});

afterEach(async () => {
  delete process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY;
  await rm(root, { recursive: true, force: true });
});

describe('candidate workflow', () => {
  it('registers an existing repository image as a Candidate with traceable job metadata', async () => {
    const core = createVisualDirectorCore();
    const result = await core.registerCandidate(candidateInput());

    expect(result.asset).toMatchObject({
      asset_id: 'asset-1',
      status: 'candidate',
      candidate_path: '.visual-director/candidates/gen-1/candidate.webp',
      source_job_id: 'gen-1',
      reference_paths: ['docs/visual/assets/global.webp'],
    });
    expect(result.workflow.jobs[0]).toMatchObject({ job_id: 'gen-1', status: 'candidate' });

    const stored = JSON.parse(await readFile(path.join(root, '.visual-director/asset-index.json'), 'utf8')) as {
      jobs: Array<{ job_id: string }>;
      assets: Array<{ asset_id: string }>;
    };
    expect(stored.jobs[0]?.job_id).toBe('gen-1');
    expect(stored.assets[0]?.asset_id).toBe('asset-1');
  });

  it('rejects a Candidate without deleting its image', async () => {
    const core = createVisualDirectorCore();
    await core.registerCandidate(candidateInput());
    const result = await core.reviewCandidate({
      project_id: 'bottom-of-thirst',
      repository_path: root,
      asset_id: 'asset-1',
      decision: 'reject',
    });

    expect(result.asset.status).toBe('rejected');
    await expect(access(path.join(root, '.visual-director/candidates/gen-1/candidate.webp'))).resolves.toBeUndefined();
    expect(result.workflow.jobs[0]?.status).toBe('rejected');
  });

  it('moves an approved Candidate to a production path and registers it', async () => {
    const core = createVisualDirectorCore();
    await core.registerCandidate(candidateInput());
    const result = await core.reviewCandidate({
      project_id: 'bottom-of-thirst',
      repository_path: root,
      asset_id: 'asset-1',
      decision: 'approve',
      production_path: 'public/images/characters/kamino_kyosuke/portrait/reviewed.webp',
    });

    expect(result.asset).toMatchObject({
      status: 'registered',
      registered_path: 'public/images/characters/kamino_kyosuke/portrait/reviewed.webp',
    });
    expect(result.asset.candidate_path).toBeUndefined();
    await expect(access(path.join(root, '.visual-director/candidates/gen-1/candidate.webp'))).rejects.toThrow();
    await expect(access(path.join(root, 'public/images/characters/kamino_kyosuke/portrait/reviewed.webp'))).resolves.toBeUndefined();
    expect(result.workflow.jobs[0]?.status).toBe('registered');
  });

  it('archives a managed Registered asset when a new Candidate replaces its production path', async () => {
    const core = createVisualDirectorCore();
    await core.registerCandidate(candidateInput());
    await core.reviewCandidate({
      project_id: 'bottom-of-thirst',
      repository_path: root,
      asset_id: 'asset-1',
      decision: 'approve',
      production_path: 'public/images/characters/kamino_kyosuke/portrait/reviewed.webp',
    });

    await writeRepoFile('.visual-director/candidates/gen-2/candidate.webp', 'candidate2');
    await core.registerCandidate({
      ...candidateInput(),
      job: {
        ...candidateInput().job,
        job_id: 'gen-2',
        request_text: '神野恭介のポートレートを再生成',
      },
      asset: {
        ...candidateInput().asset,
        asset_id: 'asset-2',
        candidate_path: '.visual-director/candidates/gen-2/candidate.webp',
      },
    });

    const result = await core.reviewCandidate({
      project_id: 'bottom-of-thirst',
      repository_path: root,
      asset_id: 'asset-2',
      decision: 'approve',
      production_path: 'public/images/characters/kamino_kyosuke/portrait/reviewed.webp',
    });

    expect(result.asset).toMatchObject({
      asset_id: 'asset-2',
      status: 'registered',
      supersedes: 'asset-1',
      registered_path: 'public/images/characters/kamino_kyosuke/portrait/reviewed.webp',
    });
    const old = result.workflow.assets.find((asset) => asset.asset_id === 'asset-1');
    expect(old).toMatchObject({
      status: 'superseded',
      archived_path: '.visual-director/superseded/asset-1/reviewed.webp',
    });
    expect(old?.registered_path).toBeUndefined();
    expect(await readFile(path.join(root, '.visual-director/superseded/asset-1/reviewed.webp'), 'utf8')).toBe('candidate');
    expect(await readFile(path.join(root, 'public/images/characters/kamino_kyosuke/portrait/reviewed.webp'), 'utf8')).toBe('candidate2');
  });

  it('fails closed for unsafe or unmanaged conflicting production paths', async () => {
    const core = createVisualDirectorCore();
    await core.registerCandidate(candidateInput());

    await expect(core.reviewCandidate({
      project_id: 'bottom-of-thirst',
      repository_path: root,
      asset_id: 'asset-1',
      decision: 'approve',
      production_path: '../outside.webp',
    })).rejects.toMatchObject({ code: 'UNSAFE_REPOSITORY_PATH' });

    await writeRepoFile('public/images/existing.webp', 'existing');
    await expect(core.reviewCandidate({
      project_id: 'bottom-of-thirst',
      repository_path: root,
      asset_id: 'asset-1',
      decision: 'approve',
      production_path: 'public/images/existing.webp',
    })).rejects.toMatchObject({ code: 'PRODUCTION_ASSET_CONFLICT' });
  });

  it('rejects duplicate job and asset ids', async () => {
    const core = createVisualDirectorCore();
    await core.registerCandidate(candidateInput());
    await writeRepoFile('.visual-director/candidates/gen-2/candidate.webp', 'candidate2');

    await expect(core.registerCandidate({
      ...candidateInput(),
      asset: {
        ...candidateInput().asset,
        asset_id: 'asset-2',
        candidate_path: '.visual-director/candidates/gen-2/candidate.webp',
      },
    })).rejects.toMatchObject({ code: 'WORKFLOW_ID_CONFLICT' });
  });

  it('keeps candidate mutations disabled in hosted read-only mode', async () => {
    process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY = '1';
    const core = createVisualDirectorCore();

    await expect(core.registerCandidate(candidateInput())).rejects.toMatchObject({ code: 'HOSTED_WRITE_DISABLED' });
  });
});

function candidateInput() {
  return {
    project_id: 'bottom-of-thirst',
    repository_path: root,
    job: {
      job_id: 'gen-1',
      asset_type: 'character_portrait',
      subject_ids: ['kamino_kyosuke'],
      request_text: '神野恭介のポートレートを生成',
      generator: 'chatgpt-images',
      generation_package_fingerprint: 'a'.repeat(64),
    },
    asset: {
      asset_id: 'asset-1',
      asset_type: 'character_portrait',
      subject_id: 'kamino_kyosuke',
      candidate_path: '.visual-director/candidates/gen-1/candidate.webp',
      generator: 'chatgpt-images',
      generation_package_fingerprint: 'a'.repeat(64),
      reference_paths: ['docs/visual/assets/global.webp'],
    },
  };
}

async function writeRepoFile(relativePath: string, contents: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}
