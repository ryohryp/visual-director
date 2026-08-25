import { VisualDirectorError } from '../domain/types.js';
import type { GenerationPackage, PrepareGenerationInput } from '../domain/types.js';
import type { VisualDirectorCore } from './visual-director.js';

export interface PrepareRequiredAssetGenerationInput {
  project_id: string;
  required_asset_id: string;
  repository_path?: string;
}

export interface RequiredAssetGenerationInput extends PrepareGenerationInput {
  required_asset_id: string;
}

export interface PreparedRequiredAssetGeneration {
  project_id: string;
  required_asset_id: string;
  production_path: string;
  generation_input: RequiredAssetGenerationInput;
  generation_package: GenerationPackage;
  execution: {
    mode: 'prepare_only';
    candidate_generation_available: false;
    reason: string;
    next_tool: 'visual.generate_image';
  };
}

const IN_PROGRESS_STATUSES = new Set(['requested', 'prepared', 'generating', 'generated']);

export async function prepareRequiredAssetGeneration(
  core: Pick<VisualDirectorCore, 'getProjectVisualOverview' | 'prepareGeneration'>,
  input: PrepareRequiredAssetGenerationInput,
): Promise<PreparedRequiredAssetGeneration> {
  const projectId = input.project_id.trim();
  const requiredAssetId = input.required_asset_id.trim();
  if (!projectId || !requiredAssetId) {
    throw new VisualDirectorError('INVALID_INPUT', 'project_id and required_asset_id must be non-empty strings.');
  }

  const overview = await core.getProjectVisualOverview({
    project_id: projectId,
    ...(input.repository_path?.trim() ? { repository_path: input.repository_path.trim() } : {}),
  });
  if (!overview.inventory.plan.available) {
    throw new VisualDirectorError(
      'ASSET_PLAN_MISSING',
      'Required Asset generation preparation needs .visual-director/asset-plan.json.',
      { project_id: projectId },
    );
  }

  const asset = overview.inventory.assets.find((item) =>
    item.kind === 'required' && comparisonKey(item.asset_id ?? '') === comparisonKey(requiredAssetId));
  if (!asset || !asset.required_definition) {
    throw new VisualDirectorError(
      'REQUIRED_ASSET_NOT_FOUND',
      `Required Asset was not found: ${requiredAssetId}.`,
      { project_id: projectId, required_asset_id: requiredAssetId },
    );
  }
  if (!asset.required) {
    throw new VisualDirectorError(
      'REQUIRED_ASSET_GENERATION_NOT_ELIGIBLE',
      'Optional assets are not offered for automatic generation preparation.',
      { project_id: projectId, required_asset_id: asset.asset_id },
    );
  }
  if (asset.status !== 'MISSING') {
    throw new VisualDirectorError(
      'REQUIRED_ASSET_GENERATION_NOT_ELIGIBLE',
      'Only MISSING Required Assets can start this generation path.',
      { project_id: projectId, required_asset_id: asset.asset_id, status: asset.status },
    );
  }

  const inProgress = overview.workflow.jobs.find((job) =>
    comparisonKey(job.required_asset_id ?? '') === comparisonKey(asset.asset_id ?? '')
      && IN_PROGRESS_STATUSES.has(job.status));
  if (inProgress) {
    throw new VisualDirectorError(
      'REQUIRED_ASSET_GENERATION_IN_PROGRESS',
      'A Generation Job is already in progress for this Required Asset.',
      { project_id: projectId, required_asset_id: asset.asset_id, job_id: inProgress.job_id, status: inProgress.status },
    );
  }

  const definition = asset.required_definition;
  const generation = definition.generation;
  const requestText = generation?.request?.trim() ?? '';
  if (!requestText) {
    throw new VisualDirectorError(
      'REQUIRED_ASSET_GENERATION_INCOMPLETE',
      'Required Asset generation.request is required before a Generation Package can be prepared.',
      { project_id: projectId, required_asset_id: definition.asset_id, path: overview.inventory.plan.metadata_path },
    );
  }

  const sceneContext: Record<string, unknown> = {};
  if (generation?.aspect_ratio?.trim()) sceneContext.aspect_ratio = generation.aspect_ratio.trim();
  if (generation?.requirements.length) sceneContext.requirements = [...generation.requirements];

  const generationInput: RequiredAssetGenerationInput = {
    project_id: projectId,
    required_asset_id: definition.asset_id,
    asset_type: definition.asset_type,
    subject_ids: [...definition.subject_ids],
    request_text: requestText,
    ...(Object.keys(sceneContext).length ? { scene_context: sceneContext } : {}),
  };
  const prepareInput: PrepareGenerationInput = {
    project_id: generationInput.project_id,
    asset_type: generationInput.asset_type,
    subject_ids: [...generationInput.subject_ids],
    request_text: generationInput.request_text,
    ...((generationInput.scene_context || input.repository_path?.trim()) ? {
      scene_context: {
        ...(generationInput.scene_context ?? {}),
        ...(input.repository_path?.trim() ? { repository_path: input.repository_path.trim() } : {}),
      },
    } : {}),
  };
  const generationPackage = await core.prepareGeneration(prepareInput);

  return {
    project_id: projectId,
    required_asset_id: definition.asset_id,
    production_path: definition.production_path,
    generation_input: generationInput,
    generation_package: generationPackage,
    execution: {
      mode: 'prepare_only',
      candidate_generation_available: false,
      reason: 'The web workspace is read-only for Candidate generation. Use the prepared input with local/tunnel visual.generate_image to create a Candidate.',
      next_tool: 'visual.generate_image',
    },
  };
}

function comparisonKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}
