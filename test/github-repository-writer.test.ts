import { describe, expect, it, vi } from 'vitest';

import { GitHubRepositoryWriter } from '../src/projects/github-repository-writer.js';

describe('GitHubRepositoryWriter', () => {
  it('creates one commit from the expected branch head and advances the ref without force', async () => {
    let blob = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.pathname.endsWith('/git/ref/heads/main')) {
        return json({ object: { sha: 'head-sha' } });
      }
      if (method === 'GET' && url.pathname.endsWith('/git/commits/head-sha')) {
        return json({ tree: { sha: 'base-tree-sha' } });
      }
      if (method === 'POST' && url.pathname.endsWith('/git/blobs')) {
        blob += 1;
        return json({ sha: `blob-${blob}` });
      }
      if (method === 'POST' && url.pathname.endsWith('/git/trees')) {
        const body = JSON.parse(String(init?.body)) as { base_tree?: string; tree?: Array<{ path?: string; sha?: string }> };
        expect(body.base_tree).toBe('base-tree-sha');
        expect(body.tree).toEqual([
          { path: 'docs/visual/CHARACTER_VISUAL_CANON.md', mode: '100644', type: 'blob', sha: 'blob-1' },
          { path: '.visual-director/compiled-canon.json', mode: '100644', type: 'blob', sha: 'blob-2' },
        ]);
        return json({ sha: 'new-tree-sha' });
      }
      if (method === 'POST' && url.pathname.endsWith('/git/commits')) {
        const body = JSON.parse(String(init?.body)) as { tree?: string; parents?: string[] };
        expect(body.tree).toBe('new-tree-sha');
        expect(body.parents).toEqual(['head-sha']);
        return json({ sha: 'new-commit-sha' });
      }
      if (method === 'PATCH' && url.pathname.endsWith('/git/refs/heads/main')) {
        const body = JSON.parse(String(init?.body)) as { sha?: string; force?: boolean };
        expect(body).toEqual({ sha: 'new-commit-sha', force: false });
        return json({ object: { sha: 'new-commit-sha' } });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const writer = new GitHubRepositoryWriter({
      owner: 'ryohryp',
      repo: 'crownless',
      ref: 'main',
      token: 'write-secret',
      fetchImpl,
    });
    const result = await writer.commitTextFiles([
      { path: 'docs/visual/CHARACTER_VISUAL_CANON.md', content: '# Canon\n' },
      { path: '.visual-director/compiled-canon.json', content: '{}\n' },
    ], 'chore(visual): adopt player-unarmed Approved Anchor');

    expect(result).toEqual({
      commit_sha: 'new-commit-sha',
      ref: 'main',
      changed_paths: ['docs/visual/CHARACTER_VISUAL_CANON.md', '.visual-director/compiled-canon.json'],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    for (const call of fetchImpl.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect((init?.headers as Record<string, string>)?.authorization).toBe('Bearer write-secret');
    }
    expect(JSON.stringify(result)).not.toContain('write-secret');
  });

  it('returns a safe write failure without exposing the GitHub response body', async () => {
    const fetchImpl = vi.fn(async () => new Response('sensitive upstream detail', { status: 403 })) as unknown as typeof fetch;
    const writer = new GitHubRepositoryWriter({
      owner: 'ryohryp', repo: 'crownless', ref: 'main', token: 'write-secret', fetchImpl,
    });

    await expect(writer.commitTextFiles([{ path: 'docs/visual/CHARACTER_VISUAL_CANON.md', content: '# Canon\n' }], 'test'))
      .rejects.toMatchObject({
        code: 'HOSTED_ANCHOR_WRITE_FAILED',
        details: { repository: 'ryohryp/crownless', ref: 'main', status: 403 },
      });
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}
