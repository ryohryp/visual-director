import type { IncomingMessage, ServerResponse } from 'node:http';

import { VisualDirectorError } from '../src/domain/types.js';
import { resolveProjectCatalog } from '../src/projects/catalog-runtime.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET');
    res.end();
    return;
  }

  try {
    const projects = resolveProjectCatalog().list().map((entry) => ({
      project_id: entry.project_id,
      display_name: entry.display_name,
      repository: `${entry.repository.owner}/${entry.repository.name}`,
      ref: entry.ref,
      adapter_type: entry.adapter_type,
    }));
    writeJson(res, 200, { projects });
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
