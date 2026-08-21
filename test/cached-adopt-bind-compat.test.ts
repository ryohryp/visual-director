import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createVisualDirectorServer } from '../src/mcp/server.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGPkEpFjYGAAAAEmAD5j+GBZAAAAAElFTkSuQmCC';
const PNG_SHA256 = '33135cdb46b55276d616f81ee83c01cd2cf07e3af536f5cf137abc5d489e9810';
const MANIFEST_PATH = 'docs/visual/assets/candidates/library/library_test.json';
const originalHostedMode = process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY;
const originalGitHubToken = process.env.VISUAL_DIRECTOR_GITHUB_TOKEN;

afterEach(() => {
  if (originalHostedMode === undefined) delete process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY;
  else process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY = originalHostedMode;
  if (originalGitHubToken === undefined) delete process.env.VISUAL_DIRECTOR_GITHUB_TOKEN;
  else process.env.VISUAL_DIRECTOR_GITHUB_TOKEN = originalGitHubToken;
  vi.unstubAllGlobals();
});

describe('cached adopt tool approved edit source compatibility', () => {
  it('returns the exact verified approved pixels without mutating Canon', async () => {
    process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY = '1';
    process.env.VISUAL_DIRECTOR_GITHUB_TOKEN = 'test-token';
    const bytes = Buffer.from(PNG_BASE64, 'base64');
    const manifest = JSON.stringify({
      candidate_id: 'library_test-generation',
      status: 'approved_candidate',
      location_base_id: 'library_base_test',
      generation: {
        generation_id: 'test-generation',
        original_dimensions: [2, 1],
        original_sha256: PNG_SHA256,
      },
    });

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/contents/docs/visual/assets/candidates/library/library_test.json?ref=main')) {
        return new Response(JSON.stringify({
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(manifest, 'utf8').toString('base64'),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://files.example.test/library.png') {
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': String(bytes.byteLength) },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createVisualDirectorServer({ enableGenerationTool: false });
    const client = new Client({ name: 'cached-adopt-bind-test', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: 'visual.adopt_anchor',
        arguments: {
          project_id: 'bottom-of-thirst',
          subject_id: '__approved_edit_source__',
          candidate_file: {
            download_url: 'https://files.example.test/library.png',
            file_id: 'file_library_test',
            mime_type: 'image/png',
            file_name: 'library.png',
          },
          candidate_path: MANIFEST_PATH,
          approval: 'approve',
        },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        project_id: 'bottom-of-thirst',
        subject_id: '__approved_edit_source__',
        status: 'approved',
        anchor_path: MANIFEST_PATH,
        approved_anchor_path: MANIFEST_PATH,
        canon_path: MANIFEST_PATH,
        changed: false,
        sha256: PNG_SHA256,
        mime_type: 'image/png',
        width: 2,
        height: 1,
      });
      expect(result.content).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('"mode": "approved_edit_source_binding"'),
        }),
        expect.objectContaining({ type: 'image', data: PNG_BASE64, mimeType: 'image/png' }),
      ]));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
