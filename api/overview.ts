import type { IncomingMessage, ServerResponse } from 'node:http';

import { prepareRequiredAssetGeneration } from '../src/core/required-asset-generation.js';
import { createVisualDirectorCore } from '../src/core/visual-director.js';
import { VisualDirectorError } from '../src/domain/types.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET, POST');
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/api/overview', 'https://visual-director.local');
  const projectId = url.searchParams.get('project_id')?.trim() ?? '';
  if (!projectId) {
    writeJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'project_id is required.' } });
    return;
  }

  if (req.method === 'POST') {
    if (url.searchParams.get('action') !== 'prepare-generation') {
      writeJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Unsupported overview action.' } });
      return;
    }
    const requiredAssetId = url.searchParams.get('required_asset_id')?.trim() ?? '';
    if (!requiredAssetId) {
      writeJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'required_asset_id is required for prepare-generation.' } });
      return;
    }
    try {
      const prepared = await prepareRequiredAssetGeneration(createVisualDirectorCore(), {
        project_id: projectId,
        required_asset_id: requiredAssetId,
      });
      writeJson(res, 200, prepared);
    } catch (error) {
      writeVisualDirectorError(res, error, 'Required Asset generation preparation failed.');
    }
    return;
  }

  try {
    const overview = await createVisualDirectorCore().getProjectVisualOverview({ project_id: projectId });
    writeJson(res, 200, overview);
  } catch (error) {
    writeVisualDirectorError(res, error, 'Visual overview could not be loaded.');
  }
}

function writeVisualDirectorError(res: ServerResponse, error: unknown, fallbackMessage: string): void {
  if (error instanceof VisualDirectorError) {
    writeJson(res, statusFor(error.code), { error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  writeJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: fallbackMessage } });
}

function statusFor(code: string): number {
  if (code === 'PROJECT_NOT_FOUND' || code === 'REQUIRED_ASSET_NOT_FOUND') return 404;
  if (code === 'REQUIRED_ASSET_GENERATION_NOT_ELIGIBLE' || code === 'REQUIRED_ASSET_GENERATION_IN_PROGRESS') return 409;
  return 422;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
