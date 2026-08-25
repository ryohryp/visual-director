import type { IncomingMessage, ServerResponse } from 'node:http';

import { prepareRequiredAssetGeneration } from '../src/core/required-asset-generation.js';
import { createVisualDirectorCore } from '../src/core/visual-director.js';
import { VisualDirectorError } from '../src/domain/types.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('allow', 'POST');
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/api/prepare-required-asset', 'https://visual-director.local');
  const projectId = url.searchParams.get('project_id')?.trim() ?? '';
  const requiredAssetId = url.searchParams.get('required_asset_id')?.trim() ?? '';
  if (!projectId || !requiredAssetId) {
    writeJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'project_id and required_asset_id are required.' } });
    return;
  }

  try {
    const prepared = await prepareRequiredAssetGeneration(createVisualDirectorCore(), {
      project_id: projectId,
      required_asset_id: requiredAssetId,
    });
    writeJson(res, 200, prepared);
  } catch (error) {
    if (error instanceof VisualDirectorError) {
      writeJson(res, statusFor(error.code), {
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    writeJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Required Asset generation preparation failed.' } });
  }
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
