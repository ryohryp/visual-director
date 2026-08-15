import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { parseWorkflowIndex, WORKFLOW_INDEX_PATH } from '../domain/visual-overview.js';
import { VisualDirectorError } from '../domain/types.js';
import type {
  CandidateWorkflowResult,
  ManagedVisualAssetSummary,
  ProjectWorkflowSummary,
  RegisterCandidateInput,
  ReviewCandidateInput,
} from '../domain/types.js';

interface RepositoryRoot {
  absolutePath: string;
  realPath: string;
}

interface Promotion {
  candidatePath: string;
  productionPath: string;
  supersededAssetId?: string;
  archivedPath?: string;
}

export async function registerCandidate(input: RegisterCandidateInput): Promise<CandidateWorkflowResult> {
  validateProjectInput(input.project_id, input.repository_path);
  const repository = await resolveRepository(input.repository_path, input.project_id);
  const candidatePath = safeRelativePath(input.asset.candidate_path, 'candidate_path');
  await ensureExistingFile(repository, candidatePath, 'CANDIDATE_NOT_FOUND');
  const referencePaths = (input.asset.reference_paths ?? []).map((value) => safeRelativePath(value, 'reference_path'));
  for (const referencePath of referencePaths) await ensureExistingFile(repository, referencePath, 'REFERENCE_NOT_FOUND');

  const workflow = await readWorkflow(repository);
  if (workflow.jobs.some((job) => job.job_id === input.job.job_id)) {
    throw new VisualDirectorError('WORKFLOW_ID_CONFLICT', `Generation Job already exists: ${input.job.job_id}.`);
  }
  if (workflow.assets.some((asset) => asset.asset_id === input.asset.asset_id)) {
    throw new VisualDirectorError('WORKFLOW_ID_CONFLICT', `Managed asset already exists: ${input.asset.asset_id}.`);
  }
  if (!input.job.subject_ids.length || input.job.subject_ids.some((value) => !value.trim())) {
    throw new VisualDirectorError('INVALID_INPUT', 'job.subject_ids must contain at least one non-empty subject id.');
  }

  const now = new Date().toISOString();
  const job = {
    job_id: required(input.job.job_id, 'job.job_id'),
    asset_type: required(input.job.asset_type, 'job.asset_type'),
    subject_ids: input.job.subject_ids.map((value) => value.trim()),
    request_text: required(input.job.request_text, 'job.request_text'),
    status: 'candidate' as const,
    ...(input.job.generator?.trim() ? { generator: input.job.generator.trim() } : {}),
    ...(input.job.generation_package_fingerprint?.trim()
      ? { generation_package_fingerprint: input.job.generation_package_fingerprint.trim() }
      : {}),
    created_at: input.job.created_at?.trim() || now,
    updated_at: now,
  };
  const asset: ManagedVisualAssetSummary = {
    asset_id: required(input.asset.asset_id, 'asset.asset_id'),
    asset_type: required(input.asset.asset_type, 'asset.asset_type'),
    status: 'candidate',
    ...(input.asset.subject_id?.trim() ? { subject_id: input.asset.subject_id.trim() } : {}),
    source_job_id: job.job_id,
    candidate_path: candidatePath,
    ...(input.asset.generator?.trim() ? { generator: input.asset.generator.trim() } : {}),
    ...(input.asset.generation_package_fingerprint?.trim()
      ? { generation_package_fingerprint: input.asset.generation_package_fingerprint.trim() }
      : {}),
    reference_paths: referencePaths,
    created_at: input.asset.created_at?.trim() || now,
  };
  const next: ProjectWorkflowSummary = {
    metadata_path: WORKFLOW_INDEX_PATH,
    available: true,
    jobs: [...workflow.jobs, job],
    assets: [...workflow.assets, asset],
  };
  await writeWorkflow(repository, next);
  return { project_id: input.project_id, asset, workflow: next };
}

export async function reviewCandidate(input: ReviewCandidateInput): Promise<CandidateWorkflowResult> {
  validateProjectInput(input.project_id, input.repository_path);
  const repository = await resolveRepository(input.repository_path, input.project_id);
  const workflow = await readWorkflow(repository);
  if (!workflow.available) throw new VisualDirectorError('WORKFLOW_INDEX_MISSING', 'No Visual Director workflow index exists.');
  const assetIndex = workflow.assets.findIndex((asset) => asset.asset_id === input.asset_id);
  if (assetIndex < 0) throw new VisualDirectorError('ASSET_NOT_FOUND', `Managed asset was not found: ${input.asset_id}.`);
  const current = workflow.assets[assetIndex] as ManagedVisualAssetSummary;
  if (current.status !== 'candidate') {
    throw new VisualDirectorError('ASSET_STATE_CONFLICT', 'Only Candidate assets can be reviewed.', {
      asset_id: current.asset_id,
      status: current.status,
    });
  }

  const now = new Date().toISOString();
  const assets = [...workflow.assets];
  let updated: ManagedVisualAssetSummary;
  let promotion: Promotion | undefined;

  if (input.decision === 'reject') {
    if (input.production_path !== undefined) {
      throw new VisualDirectorError('INVALID_INPUT', 'production_path is not allowed when rejecting a Candidate.');
    }
    updated = { ...current, status: 'rejected' };
  } else {
    const candidatePath = current.candidate_path;
    if (!candidatePath) throw new VisualDirectorError('CANDIDATE_NOT_FOUND', 'Candidate asset has no candidate_path.', { asset_id: current.asset_id });
    const productionPath = safeRelativePath(required(input.production_path, 'production_path'), 'production_path');
    if (productionPath.startsWith('.visual-director/')) {
      throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'Approved production assets cannot remain inside .visual-director/.', {
        production_path: productionPath,
      });
    }
    if (candidatePath === productionPath) throw new VisualDirectorError('INVALID_INPUT', 'production_path must differ from candidate_path.');
    await ensureExistingFile(repository, candidatePath, 'CANDIDATE_NOT_FOUND');

    const existingIndex = workflow.assets.findIndex((asset) => asset.status === 'registered' && asset.registered_path === productionPath);
    const productionExists = await pathExists(path.resolve(repository.absolutePath, productionPath));
    if (productionExists && existingIndex < 0) {
      throw new VisualDirectorError('PRODUCTION_ASSET_CONFLICT', 'The production path already exists and is not managed by Visual Director.', {
        production_path: productionPath,
      });
    }
    if (!productionExists && existingIndex >= 0) {
      throw new VisualDirectorError('WORKFLOW_INDEX_INVALID', 'A Registered asset points to a missing production file.', {
        asset_id: workflow.assets[existingIndex]?.asset_id,
        production_path: productionPath,
      });
    }

    const existing = existingIndex >= 0 ? workflow.assets[existingIndex] : undefined;
    promotion = await promoteCandidate(repository, candidatePath, productionPath, existing);
    if (existing && existingIndex >= 0 && promotion.archivedPath) {
      const { registered_path: _registeredPath, ...oldRest } = existing;
      void _registeredPath;
      assets[existingIndex] = {
        ...oldRest,
        status: 'superseded',
        archived_path: promotion.archivedPath,
      };
    }
    const { candidate_path: _candidatePath, ...rest } = current;
    void _candidatePath;
    updated = {
      ...rest,
      status: 'registered',
      registered_path: productionPath,
      approved_at: now,
      ...(promotion.supersededAssetId ? { supersedes: promotion.supersededAssetId } : {}),
    };
  }

  assets[assetIndex] = updated;
  const jobs = workflow.jobs.map((job) => job.job_id === current.source_job_id
    ? { ...job, status: input.decision === 'reject' ? 'rejected' as const : 'registered' as const, updated_at: now }
    : job);
  const next: ProjectWorkflowSummary = { ...workflow, available: true, jobs, assets };
  try {
    await writeWorkflow(repository, next);
  } catch (error) {
    if (promotion) await rollbackPromotion(repository, promotion);
    throw error;
  }
  return { project_id: input.project_id, asset: updated, workflow: next };
}

async function readWorkflow(repository: RepositoryRoot): Promise<ProjectWorkflowSummary> {
  const indexPath = path.resolve(repository.absolutePath, WORKFLOW_INDEX_PATH);
  if (!(await pathExists(indexPath))) return { metadata_path: WORKFLOW_INDEX_PATH, available: false, jobs: [], assets: [] };
  try {
    return parseWorkflowIndex(await readFile(indexPath, 'utf8'));
  } catch (error) {
    if (error instanceof VisualDirectorError) throw error;
    throw new VisualDirectorError('WORKFLOW_INDEX_READ_FAILED', 'Workflow index could not be read.', {
      path: WORKFLOW_INDEX_PATH,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function writeWorkflow(repository: RepositoryRoot, workflow: ProjectWorkflowSummary): Promise<void> {
  const directory = path.resolve(repository.absolutePath, '.visual-director');
  const indexPath = path.resolve(repository.absolutePath, WORKFLOW_INDEX_PATH);
  await mkdir(directory, { recursive: true });
  const tempPath = `${indexPath}.${randomUUID()}.tmp`;
  const contents = JSON.stringify({ jobs: workflow.jobs, assets: workflow.assets }, null, 2) + '\n';
  try {
    await writeFile(tempPath, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(tempPath, indexPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw new VisualDirectorError('WORKFLOW_INDEX_WRITE_FAILED', 'Workflow index could not be written atomically.', {
      path: WORKFLOW_INDEX_PATH,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function promoteCandidate(
  repository: RepositoryRoot,
  candidatePath: string,
  productionPath: string,
  existing?: ManagedVisualAssetSummary,
): Promise<Promotion> {
  const candidateAbsolute = path.resolve(repository.absolutePath, safeRelativePath(candidatePath, 'candidate_path'));
  const productionAbsolute = path.resolve(repository.absolutePath, productionPath);
  await ensureInside(repository, productionAbsolute, productionPath);
  await mkdir(path.dirname(productionAbsolute), { recursive: true });

  let archivedPath: string | undefined;
  if (existing) {
    archivedPath = `.visual-director/superseded/${safeId(existing.asset_id)}/${path.basename(productionPath)}`;
    const archivedAbsolute = path.resolve(repository.absolutePath, archivedPath);
    await ensureInside(repository, archivedAbsolute, archivedPath);
    if (await pathExists(archivedAbsolute)) {
      throw new VisualDirectorError('SUPERSEDED_ASSET_CONFLICT', 'The superseded archive path already exists.', { archived_path: archivedPath });
    }
    await mkdir(path.dirname(archivedAbsolute), { recursive: true });
    await rename(productionAbsolute, archivedAbsolute);
  }

  try {
    await rename(candidateAbsolute, productionAbsolute);
  } catch (error) {
    if (archivedPath) {
      const archivedAbsolute = path.resolve(repository.absolutePath, archivedPath);
      if (await pathExists(archivedAbsolute)) await rename(archivedAbsolute, productionAbsolute);
    }
    throw new VisualDirectorError('ASSET_PROMOTION_FAILED', 'Candidate could not be promoted to the production path.', {
      candidate_path: candidatePath,
      production_path: productionPath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    candidatePath,
    productionPath,
    ...(existing ? { supersededAssetId: existing.asset_id } : {}),
    ...(archivedPath ? { archivedPath } : {}),
  };
}

async function rollbackPromotion(repository: RepositoryRoot, promotion: Promotion): Promise<void> {
  const production = path.resolve(repository.absolutePath, promotion.productionPath);
  const candidate = path.resolve(repository.absolutePath, safeRelativePath(promotion.candidatePath, 'candidate_path'));
  try {
    await mkdir(path.dirname(candidate), { recursive: true });
    if (await pathExists(production)) await rename(production, candidate);
    if (promotion.archivedPath) {
      const archived = path.resolve(repository.absolutePath, promotion.archivedPath);
      await mkdir(path.dirname(production), { recursive: true });
      if (await pathExists(archived)) await rename(archived, production);
    }
  } catch {
    // Best-effort rollback; the workflow write error remains the primary failure.
  }
}

async function resolveRepository(repositoryPath: string, projectId: string): Promise<RepositoryRoot> {
  const absolutePath = path.resolve(repositoryPath.trim());
  try {
    const stats = await stat(absolutePath);
    if (!stats.isDirectory()) throw new Error('Path is not a directory.');
    return { absolutePath, realPath: await realpath(absolutePath) };
  } catch (error) {
    throw new VisualDirectorError('PROJECT_REPOSITORY_INVALID', 'The configured repository path cannot be used.', {
      project_id: projectId,
      repository_path: absolutePath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function ensureExistingFile(repository: RepositoryRoot, relativePath: string, code: string): Promise<void> {
  const safe = safeRelativePath(relativePath, 'path');
  const absolute = path.resolve(repository.absolutePath, safe);
  await ensureInside(repository, absolute, safe);
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Path is not a regular file.');
    const resolved = await realpath(absolute);
    if (!isInsideOrEqual(repository.realPath, resolved)) throw new Error('Path resolves outside repository.');
  } catch (error) {
    throw new VisualDirectorError(code, 'Repository file does not exist or is unsafe.', {
      path: safe,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function ensureInside(repository: RepositoryRoot, absolute: string, relative: string): Promise<void> {
  if (!isInsideOrEqual(repository.absolutePath, absolute)) {
    throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'Repository path resolves outside the configured repository.', { path: relative });
  }
}

function isInsideOrEqual(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safeRelativePath(value: string, field: string): string {
  const normalized = required(value, field).replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', `${field} must be a safe repository-relative path.`, { [field]: value });
  }
  return normalized;
}

function safeId(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'asset_id cannot be used for a superseded archive path.', { asset_id: value });
  }
  return value;
}

function required(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) throw new VisualDirectorError('INVALID_INPUT', `${field} must be a non-empty string.`);
  return trimmed;
}

function validateProjectInput(projectId: string, repositoryPath: string): void {
  required(projectId, 'project_id');
  required(repositoryPath, 'repository_path');
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}
