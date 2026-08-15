import { VisualDirectorError } from './types.js';
import type {
  GenerationJobStatus,
  GenerationJobSummary,
  ManagedAssetStatus,
  ManagedVisualAssetSummary,
  ProjectWorkflowSummary,
} from './types.js';

export const WORKFLOW_INDEX_PATH = '.visual-director/asset-index.json' as const;

const JOB_STATUSES = new Set<GenerationJobStatus>([
  'requested', 'prepared', 'generating', 'generated', 'candidate', 'approved', 'rejected', 'registered', 'superseded', 'failed',
]);
const ASSET_STATUSES = new Set<ManagedAssetStatus>(['candidate', 'approved', 'rejected', 'registered', 'superseded']);

export function emptyWorkflowSummary(): ProjectWorkflowSummary {
  return { metadata_path: WORKFLOW_INDEX_PATH, available: false, jobs: [], assets: [] };
}

export function parseWorkflowIndex(markdown: string): ProjectWorkflowSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(markdown);
  } catch (error) {
    throw invalidIndex('Workflow asset index is not valid JSON.', error);
  }
  if (!isRecord(parsed)) throw invalidIndex('Workflow asset index must be a JSON object.');
  const jobs = parsed.jobs ?? [];
  const assets = parsed.assets ?? [];
  if (!Array.isArray(jobs) || !Array.isArray(assets)) throw invalidIndex('Workflow asset index jobs and assets must be arrays.');
  return {
    metadata_path: WORKFLOW_INDEX_PATH,
    available: true,
    jobs: jobs.map(parseJob),
    assets: assets.map(parseAsset),
  };
}

function parseJob(value: unknown, index: number): GenerationJobSummary {
  if (!isRecord(value)) throw invalidIndex(`jobs[${index}] must be an object.`);
  const jobId = requiredString(value.job_id, `jobs[${index}].job_id`);
  const assetType = requiredString(value.asset_type, `jobs[${index}].asset_type`);
  const requestText = requiredString(value.request_text, `jobs[${index}].request_text`);
  const status = requiredString(value.status, `jobs[${index}].status`) as GenerationJobStatus;
  if (!JOB_STATUSES.has(status)) throw invalidIndex(`jobs[${index}].status is not supported.`);
  if (!Array.isArray(value.subject_ids) || !value.subject_ids.every(isNonEmptyString)) {
    throw invalidIndex(`jobs[${index}].subject_ids must be an array of non-empty strings.`);
  }
  return compact({
    job_id: jobId,
    asset_type: assetType,
    subject_ids: value.subject_ids.map((item) => item.trim()),
    request_text: requestText,
    status,
    generator: optionalString(value.generator),
    generation_package_fingerprint: optionalString(value.generation_package_fingerprint),
    created_at: optionalString(value.created_at),
    updated_at: optionalString(value.updated_at),
    error: optionalString(value.error),
  });
}

function parseAsset(value: unknown, index: number): ManagedVisualAssetSummary {
  if (!isRecord(value)) throw invalidIndex(`assets[${index}] must be an object.`);
  const assetId = requiredString(value.asset_id, `assets[${index}].asset_id`);
  const assetType = requiredString(value.asset_type, `assets[${index}].asset_type`);
  const status = requiredString(value.status, `assets[${index}].status`) as ManagedAssetStatus;
  if (!ASSET_STATUSES.has(status)) throw invalidIndex(`assets[${index}].status is not supported.`);
  const referencePaths = value.reference_paths ?? [];
  if (!Array.isArray(referencePaths) || !referencePaths.every(isNonEmptyString)) {
    throw invalidIndex(`assets[${index}].reference_paths must be an array of non-empty strings.`);
  }
  return compact({
    asset_id: assetId,
    asset_type: assetType,
    status,
    subject_id: optionalString(value.subject_id),
    source_job_id: optionalString(value.source_job_id),
    candidate_path: optionalString(value.candidate_path),
    registered_path: optionalString(value.registered_path),
    archived_path: optionalString(value.archived_path),
    generator: optionalString(value.generator),
    generation_package_fingerprint: optionalString(value.generation_package_fingerprint),
    reference_paths: referencePaths.map((item) => item.trim()),
    created_at: optionalString(value.created_at),
    approved_at: optionalString(value.approved_at),
    supersedes: optionalString(value.supersedes),
  });
}

function requiredString(value: unknown, field: string): string {
  if (!isNonEmptyString(value)) throw invalidIndex(`${field} must be a non-empty string.`);
  return value.trim();
}
function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isNonEmptyString(value)) throw invalidIndex('Optional workflow string values must be non-empty when present.');
  return value.trim();
}
function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
function invalidIndex(message: string, error?: unknown): VisualDirectorError {
  return new VisualDirectorError('WORKFLOW_INDEX_INVALID', message, {
    path: WORKFLOW_INDEX_PATH,
    ...(error ? { reason: error instanceof Error ? error.message : String(error) } : {}),
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
