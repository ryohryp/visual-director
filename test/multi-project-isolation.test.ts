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
    expect(a.inventory.assets.map((asset) => asset.asset_id)).toEqual(['required-a']);
    expect(b.inventory.assets.map((asset) => asset.asset_id)).toEqual(['required-b']);
    expect(a.inventory.assets.some((asset) => asset.asset_id === 'required-b')).toBe(false);
    expect(b.inventory.assets.some((asset) => asset.asset_id === 'required-a')).toBe(false);

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
      const accepts: Array<string | null> = [];
      globalThis.fetch = async (input, init) => {
        calls.push(String(input));
        accepts.push(new Headers(init?.headers).get('accept'));
        return new Response(Buffer.from('asset-bytes'));
      };

      const a = await invokeAsset('/api/asset?project_id=game-a&path=public/images/shared.png');
      expect(a.statusCode).toBe(200);
      expect(a.body.toString('utf8')).toBe('asset-bytes');
      expect(calls.at(-1)).toContain('/repos/example/repo-a/contents/public/images/shared.png?ref=main');
      expect(accepts.at(-1)).toBe('application/vnd.github.raw+json');

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

  it('streams repository assets larger than the Contents API base64 limit through raw media', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'visual-director-large-asset-'));
    try {
      const entry = entries[0]!;
      const catalogPath = path.join(directory, 'projects.json');
      await writeFile(catalogPath, JSON.stringify({ projects: [{
        project_id: entry.project_id,
        display_name: entry.display_name,
        repository: `${entry.repository.owner}/${entry.repository.name}`,
        ref: entry.ref,
        adapter_type: entry.adapter_type,
      }] }));
      process.env.VISUAL_DIRECTOR_PROJECT_CATALOG = catalogPath;
      process.env.VISUAL_DIRECTOR_GITHUB_TOKEN = 'test-token';
      const largePng = Buffer.alloc(1024 * 1024 + 1, 0x5a);
      globalThis.fetch = async (_input, init) => {
        expect(new Headers(init?.headers).get('accept')).toBe('application/vnd.github.raw+json');
        return new Response(largePng);
      };

      const result = await invokeAsset('/api/asset?project_id=game-a&path=assets/approved-anchor.png');

      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual(largePng);
      expect(result.headers.get('content-type')).toBe('image/png');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function repositoryResponse(url: string): Response {
  if (!url.includes('/contents/')) return new Response('{}', { status: 200 });
  const repo = url.includes('/repo-a/') ? 'a' : url.includes('/repo-b/') ? 'b' : 'unknown';
  if (url.includes('.visual-director/manifest.json')) {
    return fileResponse(JSON.stringify({
      version: 1,
      project_id: `game-${repo}`,
      subjects: {},
    }));
  }
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
        required_asset_id: `required-${repo}`,
        asset_type: 'scene',
        subject_id: `subject-${repo}`,
        status: 'candidate',
        candidate_path: `candidates/${repo}.png`,
        reference_paths: [`references/${repo}.png`],
      }],
    }));
  }
  if (url.includes('.visual-director/asset-plan.json')) {
    return fileResponse(JSON.stringify({
      version: 1,
      assets: [{
        asset_id: `required-${repo}`,
        asset_type: 'scene',
        title: `Required ${repo}`,
        usage: `game-${repo}`,
        production_path: `public/images/${repo}.png`,
        subject_ids: [`subject-${repo}`],
        required: true,
      }],
    }));
  }
  if (url.includes(`/contents/public/images/${repo}.png?`)) return new Response('{}', { status: 404 });
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

async function invokeAsset(url: string): Promise<{ statusCode: number; body: Buffer; headers: Map<string, string> }> {
  let statusCode = 0;
  let body = Buffer.alloc(0);
  const headers = new Map<string, string>();
  const res = {
    set statusCode(value: number) { statusCode = value; },
    get statusCode() { return statusCode; },
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    end(value?: string | Buffer) { body = Buffer.isBuffer(value) ? value : Buffer.from(value ?? ''); },
  } as unknown as ServerResponse;
  await assetHandler({ method: 'GET', url } as IncomingMessage, res);
  return { statusCode, body, headers };
}
