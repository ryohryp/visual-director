import { describe, expect, it } from 'vitest';

import { GitHubRepositorySource } from '../src/projects/repository-source.js';

function githubFile(content: string): Response {
  return new Response(JSON.stringify({ type: 'file', encoding: 'base64', content: Buffer.from(content).toString('base64') }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GitHubRepositorySource', () => {
  it('reads UTF-8 content from the GitHub contents API', async () => {
    const calls: string[] = [];
    const source = new GitHubRepositorySource({
      owner: 'ryohryp',
      repo: 'private-game',
      ref: 'main',
      token: 'secret-token',
      fetchImpl: async (input) => {
        calls.push(String(input));
        return githubFile('# Canon\n神野 恭介');
      },
    });

    await expect(source.readText('docs/visual/CANON.md', 'Canon')).resolves.toContain('神野 恭介');
    expect(calls[0]).toContain('/repos/ryohryp/private-game/contents/docs/visual/CANON.md?ref=main');
  });

  it('fails closed when a repository file is missing', async () => {
    const source = new GitHubRepositorySource({
      owner: 'ryohryp', repo: 'private-game', token: 'token',
      fetchImpl: async () => new Response('{}', { status: 404 }),
    });

    await expect(source.ensureFile('missing.avif', 'Approved Anchor')).rejects.toMatchObject({
      code: 'REFERENCE_NOT_FOUND',
    });
  });

  it('treats authentication and API failures as repository failures, not missing Canon', async () => {
    const source = new GitHubRepositorySource({
      owner: 'ryohryp', repo: 'private-game', token: 'token',
      fetchImpl: async () => new Response('{}', { status: 401 }),
    });

    await expect(source.readText('docs/WORLD_DIRECTION.md', 'World Direction')).rejects.toMatchObject({
      code: 'GITHUB_REPOSITORY_UNAVAILABLE',
      details: { status: 401 },
    });
  });

  it('recursively lists only repository files beneath an explicit hosted scan root', async () => {
    const calls: string[] = [];
    const source = new GitHubRepositorySource({
      owner: 'ryohryp', repo: 'private-game', ref: 'release', token: 'token',
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/contents/public/images/backgrounds?')) {
          return new Response(JSON.stringify([
            { type: 'file', path: 'public/images/backgrounds/gate.webp' },
          ]));
        }
        return new Response(JSON.stringify([
          { type: 'file', path: 'public/images/hero.png' },
          { type: 'dir', path: 'public/images/backgrounds' },
        ]));
      },
    });

    await expect(source.listFiles('public/images')).resolves.toEqual([
      'public/images/backgrounds/gate.webp',
      'public/images/hero.png',
    ]);
    expect(calls).toEqual([
      expect.stringContaining('/contents/public/images?ref=release'),
      expect.stringContaining('/contents/public/images/backgrounds?ref=release'),
    ]);
  });

  it('treats a missing explicit scan root as an empty scope', async () => {
    const source = new GitHubRepositorySource({
      owner: 'ryohryp', repo: 'private-game', token: 'token',
      fetchImpl: async () => new Response('{}', { status: 404 }),
    });

    await expect(source.listFiles('public/images')).resolves.toEqual([]);
  });

  it('fails closed when a hosted directory response escapes the requested scan scope', async () => {
    const source = new GitHubRepositorySource({
      owner: 'ryohryp', repo: 'private-game', token: 'token',
      fetchImpl: async () => new Response(JSON.stringify([
        { type: 'file', path: 'docs/outside.png' },
      ])),
    });

    await expect(source.listFiles('public/images')).rejects.toMatchObject({ code: 'ASSET_SCAN_FAILED' });
  });
});
