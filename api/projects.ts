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

  try {
    writeJson(res, 200, { projects: await createVisualDirectorCore().listProjects() });
  } catch (error) {
    if (error instanceof VisualDirectorError) {
      writeJson(res, 422, { error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    writeJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Projects could not be loaded.' } });
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
