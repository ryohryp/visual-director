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

  const url = new URL(req.url ?? '/api/anchor-detail', 'https://visual-director.local');
  const projectId = url.searchParams.get('project_id')?.trim() || 'bottom-of-thirst';
  const subjectId = url.searchParams.get('subject_id')?.trim() || '';
  if (!subjectId) {
    writeJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'subject_id is required.' } });
    return;
  }

  const core = createVisualDirectorCore();
  try {
    const [overview, generation] = await Promise.all([
      core.getProjectVisualOverview({ project_id: projectId }),
      core.prepareGeneration({
        project_id: projectId,
        asset_type: 'character_portrait',
        subject_ids: [subjectId],
        request_text: 'Inspect the current Approved Visual Anchor and its controlling Canon constraints.',
      }),
    ]);
    const anchor = overview.approved_anchors.find((item) => item.subject_id === subjectId);
    if (!anchor) {
      writeJson(res, 404, { error: { code: 'APPROVED_ANCHOR_NOT_FOUND', message: `No Approved Anchor is registered for ${subjectId}.` } });
      return;
    }
    const relatedAssets = overview.workflow.assets.filter((asset) => asset.subject_id === subjectId);
    const anchorReference = generation.reference_assets.find((asset) => asset.role === 'subject_anchor' && asset.subject_id === subjectId);
    writeJson(res, 200, {
      project_id: projectId,
      anchor,
      canon_constraints: {
        subject_lock: generation.prompt_package.subject_lock,
        style_lock: generation.prompt_package.style_lock,
        allowed_changes: generation.prompt_package.allowed_changes,
        forbidden_changes: generation.prompt_package.forbidden_changes,
        avoid_block: generation.prompt_package.avoid_block,
      },
      lineage: {
        global_reference: generation.reference_assets.find((asset) => asset.role === 'global_reference') ?? null,
        subject_anchor: anchorReference ?? null,
        related_assets: relatedAssets,
      },
    });
  } catch (error) {
    if (error instanceof VisualDirectorError) {
      writeJson(res, 422, { error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    writeJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Anchor detail could not be loaded.' } });
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
