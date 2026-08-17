import type { IncomingMessage, ServerResponse } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import projectsHandler from '../api/projects.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('project list API', () => {
  it('returns catalog metadata without reading project repositories', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('Project list must not perform network access.');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const recorder = createResponseRecorder();
    await projectsHandler({ method: 'GET' } as IncomingMessage, recorder.response);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(recorder.response.statusCode).toBe(200);
    expect(recorder.headers.get('cache-control')).toBe('no-store');

    const payload = JSON.parse(recorder.body()) as { projects: Array<Record<string, unknown>> };
    expect(payload.projects).toEqual(expect.arrayContaining([
      {
        project_id: 'bottom-of-thirst',
        display_name: 'The Bottom of Thirst',
        repository: 'ryohryp/---The-Bottom-of-Thirst',
        ref: 'main',
        adapter_type: 'generic',
      },
      {
        project_id: 'crownless',
        display_name: 'Crownless',
        repository: 'ryohryp/crownless',
        ref: 'main',
        adapter_type: 'generic',
      },
    ]));

    for (const project of payload.projects) {
      expect(project).not.toHaveProperty('thumbnail');
      expect(project).not.toHaveProperty('diagnostics');
      expect(project).not.toHaveProperty('anchors');
      expect(project).not.toHaveProperty('jobs');
    }
  });
});

function createResponseRecorder(): {
  response: ServerResponse;
  headers: Map<string, string | number | readonly string[]>;
  body: () => string;
} {
  const headers = new Map<string, string | number | readonly string[]>();
  let body = '';
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) body = String(chunk);
      return this;
    },
  } as unknown as ServerResponse;
  return { response, headers, body: () => body };
}
