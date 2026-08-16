import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import assetHandler from '../api/asset.js';
import { createVisualDirectorCore } from '../src/core/visual-director.js';
import { createProjectCatalog } from '../src/projects/catalog.js';
import type { ProjectCatalogEntry } from '../src/projects/catalog.js';

const entries: ProjectCatalogEntry[] = [
  {
    project_id: 'game-a',
    display_name: 'Game A',
    repository: { owner: 'example', name: 'repo-a' },
    ref: 'main',
    adapter_type: 'generic',
  },
  {
    project_id: 'game-b',
    display_name: 'Game B',
    repository: { owner: 'example', name: 'repo-b' },
    ref: 'release',
    adapter_type: 'generic',
  },
];

const previousToken = process.env.VISUAL_DIRECTOR_GITHUB_TOKEN;
const previousCatalog = process.env.VISUAL_DIRECTOR_PROJECT_CATALOG;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (previousToken === undefined) delete process.env.VISUAL_DIRECTOR_GITHUB_TOKEN;
  else process.env.VISUAL_DIRECTOR_GITHUB_TOKEN = previousToken;
  if (previousCatalog === undefined) delete process.env.VISUAL_DIRECTOR_PROJECT_CATALOG;
  else process.env.VISUAL_DIRECTOR_PROJECT_CATALOG = previousCatalog;
  globalThis.fetch = originalFetch;
});

describe('v0.4 multi-project isolation', () => {
  it('loads overview, jobs, assets, and summaries from each selected repository only', async () => {
    process.env.VISUAL_DIRECTOR_GITHUB_TOKEN = 'test-token';
    const calls: string[] = [];
    const core = createVisualDirectorCore({
      projectCatalog: createProjectCatalog(entries),
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        return repositoryResponse(url);
      },
    });

    const a = await core.getProjectVisualOverview({ project_id: 'game-a' });
    const b = await core.getProjectVisualOverview({ project_id: 'game-b' });

    expect(a.project_id).toBe('game-a');
    expect(a.workflow.jobs.map((job) => job.job_id)).toEqual(['job-a']);
    expect(a.workflow.assets.map((asset) => asset.asset_id)).toEqual(['asset-a']);
    expect(b.project_id).toBe('game-b');
    expect(b.workflow.jobs.map((job) => job.job_id)).toEqual(['job-b']);
    expect(b.workflow.assets.map((asset) => asset.asset_id)).toEqual(['asset-b']);
    expect(a.workflow.jobs.some((job) => job.job_id === 'job-b')).toBe(false);
    expect(b.workflow.assets.some((asset) => asset.asset_id === 'asset-a')).toBe(false);

    const summaries = await core.listProjects();
    expect(summaries.map(({ project_id, repository, jobs, candidates }) => ({ project_id, repository, jobs, candidates })))
      .toEqual([
        { project_id: 'game-a', repository: 'example/repo-a', jobs: 1, candidates: 1 },
        { project_id: 'game-b', repository: 'example/repo-b', jobs: 1, candidates: 1 },
      ]);

    expect(calls.some((url) => url.includes('/repos/example/repo-a/'))).toBe(true);
    expect(calls.some((url) => url.includes('/repos/example/repo-b/'))).toBe(true);
    await expect(core.getProjectVisualOverview({ project_id: 'unknown-game' }))
      .rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('scopes the asset proxy to the catalog repository and rejects traversal/unknown projects', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'visual-director-catalog-'));
    try {
      const catalogPath = path.join(directory, 'projects.json');
      await writeFile(catalogPath, JSON.stringify({
        projects: entries.map((entry) => ({
          project_id: entry.project_id,
          display_name: entry.display_name,
          repository: `${entry.repository.owner}/${entry.repository.name}`,
          ref: entry.ref,
          adapter_type: entry.adapter_type,
        })),
      }));
      process.env.VISUAL_DIRECTOR_PROJECT_CATALOG = catalogPath;
      process.env.VISUAL_DIRECTOR_GITHUB_TOKEN = 'test-token';
      const calls: string[] = [];
      globalThis.fetch = async (input) => {
        calls.push(String(input));
        return fileResponse('asset-bytes');
      };

      const a = await invokeAsset('/api/asset?project_id=game-a&path=public/images/shared.png');
      expect(a.statusCode).toBe(200);
      expect(calls.at(-1)).toContain('/repos/example/repo-a/contents/public/images/shared.png?ref=main');

      const b = await invokeAsset('/api/asset?project_id=game-b&path=public/images/shared.png');
      expect(b.statusCode).toBe(200);
      expect(calls.at(-1)).toContain('/repos/example/repo-b/contents/public/images/shared.png?ref=release');

      const beforeRejected = calls.length;
      expect((await invokeAsset('/api/asset?project_id=game-b&path=../repo-a/secret.png')).statusCode).toBe(400);
      expect((await invokeAsset('/api/asset?project_id=unknown-game&path=public/images/shared.png')).statusCode).toBe(404);
      expect(calls).toHaveLength(beforeRejected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function repositoryResponse(url: string): Response {
  if (!url.includes('/contents/')) return new Response('{}', { status: 200 });
  const repo = url.includes('/repo-a/') ? 'a' : url.includes('/repo-b/') ? 'b' : 'unknown';
  if (url.includes('.visual-director/asset-index.json')) {
    return fileResponse(JSON.stringify({
      jobs: [{
        job_id: `job-${repo}`,
        asset_type: 'scene',
        subject_ids: [`subject-${repo}`],
        request_text: `request-${repo}`,
        status: 'candidate',
      }],
      assets: [{
        asset_id: `asset-${repo}`,
        asset_type: 'scene',
        subject_id: `subject-${repo}`,
        status: 'candidate',
        candidate_path: `candidates/${repo}.png`,
        reference_paths: [`references/${repo}.png`],
      }],
    }));
  }
  return fileResponse('# fixture\n');
}

function fileResponse(content: string): Response {
  return new Response(JSON.stringify({
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(content).toString('base64'),
    name: 'fixture.png',
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function invokeAsset(url: string): Promise<{ statusCode: number; body: Buffer }> {
  let statusCode = 0;
  let body = Buffer.alloc(0);
  const res = {
    set statusCode(value: number) { statusCode = value; },
    get statusCode() { return statusCode; },
    setHeader() {},
    end(value?: string | Buffer) { body = Buffer.isBuffer(value) ? value : Buffer.from(value ?? ''); },
  } as unknown as ServerResponse;
  await assetHandler({ method: 'GET', url } as IncomingMessage, res);
  return { statusCode, body };
}
