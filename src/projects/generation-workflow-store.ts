import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { parseWorkflowIndex, WORKFLOW_INDEX_PATH } from '../domain/visual-overview.js';
import { VisualDirectorError } from '../domain/types.js';
import type { GenerationJobSummary, ManagedVisualAssetSummary, ProjectWorkflowSummary } from '../domain/types.js';

const RETRYABLE_REQUIRED_ASSET_JOB_STATES = new Set(['failed', 'rejected', 'superseded']);

export async function beginGenerationJob(
  repositoryPath: string,
  job: GenerationJobSummary,
): Promise<ProjectWorkflowSummary> {
  const workflow = await readWorkflow(repositoryPath);
  if (workflow.jobs.some((item) => item.job_id === job.job_id)) {
    throw new VisualDirectorError('WORKFLOW_ID_CONFLICT', `Generation Job already exists: ${job.job_id}.`);
  }
  if (job.required_asset_id) {
    const requiredAssetKey = comparisonKey(job.required_asset_id);
    const existing = workflow.jobs.find((item) =>
      item.required_asset_id
      && comparisonKey(item.required_asset_id) === requiredAssetKey
      && !RETRYABLE_REQUIRED_ASSET_JOB_STATES.has(item.status));
    if (existing) {
      throw new VisualDirectorError(
        'WORKFLOW_REQUIRED_ASSET_CONFLICT',
        'A non-terminal Generation Job already exists for this Required Asset.',
        {
          required_asset_id: job.required_asset_id,
          existing_job_id: existing.job_id,
          existing_status: existing.status,
        },
      );
    }
  }
  const next: ProjectWorkflowSummary = {
    metadata_path: WORKFLOW_INDEX_PATH,
    available: true,
    jobs: [...workflow.jobs, { ...job, status: 'generating' }],
    assets: workflow.assets,
  };
  await writeWorkflow(repositoryPath, next);
  return next;
}

export async function completeGenerationJob(
  repositoryPath: string,
  jobId: string,
  asset: ManagedVisualAssetSummary,
): Promise<ProjectWorkflowSummary> {
  const workflow = await readWorkflow(repositoryPath);
  if (workflow.assets.some((item) => item.asset_id === asset.asset_id)) {
    throw new VisualDirectorError('WORKFLOW_ID_CONFLICT', `Managed asset already exists: ${asset.asset_id}.`);
  }
  let found = false;
  const now = new Date().toISOString();
  const jobs = workflow.jobs.map((job) => {
    if (job.job_id !== jobId) return job;
    found = true;
    return { ...job, status: 'candidate' as const, updated_at: now };
  });
  if (!found) throw new VisualDirectorError('JOB_NOT_FOUND', `Generation Job was not found: ${jobId}.`);
  const next: ProjectWorkflowSummary = {
    metadata_path: WORKFLOW_INDEX_PATH,
    available: true,
    jobs,
    assets: [...workflow.assets, asset],
  };
  await writeWorkflow(repositoryPath, next);
  return next;
}

export async function failGenerationJob(repositoryPath: string, jobId: string, errorMessage: string): Promise<void> {
  const workflow = await readWorkflow(repositoryPath);
  let found = false;
  const jobs = workflow.jobs.map((job) => {
    if (job.job_id !== jobId) return job;
    found = true;
    return { ...job, status: 'failed' as const, error: errorMessage, updated_at: new Date().toISOString() };
  });
  if (!found) return;
  await writeWorkflow(repositoryPath, { ...workflow, available: true, jobs });
}

async function readWorkflow(repositoryPath: string): Promise<ProjectWorkflowSummary> {
  const indexPath = path.resolve(repositoryPath, WORKFLOW_INDEX_PATH);
  if (!(await exists(indexPath))) return { metadata_path: WORKFLOW_INDEX_PATH, available: false, jobs: [], assets: [] };
  return parseWorkflowIndex(await readFile(indexPath, 'utf8'));
}

async function writeWorkflow(repositoryPath: string, workflow: ProjectWorkflowSummary): Promise<void> {
  const directory = path.resolve(repositoryPath, '.visual-director');
  const indexPath = path.resolve(repositoryPath, WORKFLOW_INDEX_PATH);
  await mkdir(directory, { recursive: true });
  const temp = `${indexPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ jobs: workflow.jobs, assets: workflow.assets }, null, 2) + '\n', { flag: 'wx' });
    await rename(temp, indexPath);
  } catch (error) {
    await rm(temp, { force: true });
    throw new VisualDirectorError('WORKFLOW_INDEX_WRITE_FAILED', 'Workflow index could not be written atomically.', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

function comparisonKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}
