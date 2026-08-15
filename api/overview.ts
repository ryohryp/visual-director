import type { IncomingMessage, ServerResponse } from 'node:http';

import { createVisualDirectorCore } from '../src/core/visual-director.js';
import { VisualDirectorError } from '../src/domain/types.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET');
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/api/overview', 'https://visual-director.local');
  const projectId = url.searchParams.get('project_id')?.trim() || 'bottom-of-thirst';
  try {
    const overview = await createVisualDirectorCore().getProjectVisualOverview({ project_id: projectId });
    writeJson(res, 200, overview);
  } catch (error) {
    if (error instanceof VisualDirectorError) {
      writeJson(res, 422, { error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    writeJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Visual overview could not be loaded.' } });
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
