import path from 'node:path';

import { ASSET_PLAN_PATH, isImagePath, parseRequiredAssetPlan, safeRepositoryPath } from '../domain/asset-plan.js';
import { VisualDirectorError } from '../domain/types.js';
import type {
  ApprovedAnchorSummary,
  AssetInventoryIssue,
  AssetInventoryItem,
  AssetInventoryStatus,
  AssetInventoryTypeCounts,
  GenerationJobSummary,
  ManagedVisualAssetSummary,
  ProjectAssetInventory,
  ProjectVisualOverview,
  ProjectWorkflowSummary,
  RequiredAssetDefinition,
  RequiredAssetPlan,
} from '../domain/types.js';
import type { RepositorySource } from './repository-source.js';

interface AssetInventoryContext {
  source: RepositorySource;
  workflow: ProjectWorkflowSummary;
  approvedAnchors: ApprovedAnchorSummary[];
  visualDirection: ProjectVisualOverview['visual_direction'];
}

interface ReconciliationContext extends AssetInventoryContext {
  plan: RequiredAssetPlan;
}

export function emptyProjectAssetInventory(): ProjectAssetInventory {
  return {
    plan: {
      metadata_path: ASSET_PLAN_PATH,
      available: false,
      version: null,
      scan_roots: [],
      ignore: [],
    },
    summary: emptySummary(),
    assets: [],
  };
}

export async function loadProjectAssetInventory(context: AssetInventoryContext): Promise<ProjectAssetInventory> {
  if (!(await context.source.fileExists(ASSET_PLAN_PATH))) return emptyProjectAssetInventory();
  const raw = await context.source.readText(ASSET_PLAN_PATH, 'Visual Director Required Asset Plan');
  const plan = parseRequiredAssetPlan(raw);
  return reconcileProjectAssetInventory({ ...context, plan });
}

export async function reconcileProjectAssetInventory(context: ReconciliationContext): Promise<ProjectAssetInventory> {
  const { source, workflow, approvedAnchors, visualDirection, plan } = context;
  const exists = createExistenceReader(source);
  const jobsById = new Map(workflow.jobs.map((job) => [job.job_id, job]));
  const planById = new Map(plan.assets.map((asset) => [comparisonKey(asset.asset_id), asset]));
  const planByPath = new Map(plan.assets.map((asset) => [comparisonKey(asset.production_path), asset]));
  const matches = new Map<string, ManagedVisualAssetSummary[]>();
  const assignedAssets = new Set<ManagedVisualAssetSummary>();

  for (const definition of plan.assets) matches.set(definition.asset_id, []);
  for (const asset of workflow.assets) {
    const sourceJob = asset.source_job_id ? jobsById.get(asset.source_job_id) : undefined;
    const candidateIds = new Set<string>();
    const unknownRequiredIds = new Map<string, string>();
    for (const requiredAssetId of [asset.required_asset_id, sourceJob?.required_asset_id]) {
      if (!requiredAssetId) continue;
      const definition = planById.get(comparisonKey(requiredAssetId));
      if (definition) candidateIds.add(definition.asset_id);
      else unknownRequiredIds.set(comparisonKey(requiredAssetId), requiredAssetId);
    }
    const assetIdMatch = planById.get(comparisonKey(asset.asset_id));
    if (assetIdMatch) candidateIds.add(assetIdMatch.asset_id);
    if (asset.registered_path) {
      const pathMatch = planByPath.get(comparisonKey(asset.registered_path));
      if (pathMatch) candidateIds.add(pathMatch.asset_id);
    }
    if (candidateIds.size + unknownRequiredIds.size > 1) {
      throw new VisualDirectorError(
        'ASSET_INVENTORY_CONFLICT',
        `Managed asset ${asset.asset_id} points to more than one Required Asset definition.`,
        {
          asset_id: asset.asset_id,
          required_asset_ids: [...candidateIds, ...unknownRequiredIds.values()],
          path: ASSET_PLAN_PATH,
        },
      );
    }
    if (unknownRequiredIds.size) continue;
    const requiredAssetId = [...candidateIds][0];
    if (!requiredAssetId) continue;
    matches.get(requiredAssetId)?.push(asset);
    assignedAssets.add(asset);
  }

  const requiredItems = await Promise.all(plan.assets.map((definition) => reconcileRequiredAsset(
    definition,
    matches.get(definition.asset_id) ?? [],
    workflow.jobs,
    exists,
  )));
  const managedItems = await Promise.all(workflow.assets.flatMap((asset, index) => assignedAssets.has(asset)
    ? []
    : [reconcileUnplannedManagedAsset(asset, index, jobsById, planById, exists)]));

  const managedPaths = new Set<string>();
  const addManagedPath = (value: string | undefined): void => {
    if (value) managedPaths.add(comparisonKey(value));
  };
  for (const definition of plan.assets) addManagedPath(definition.production_path);
  for (const anchor of approvedAnchors) addManagedPath(anchor.path);
  addManagedPath(visualDirection.global_style.asset_path);
  addManagedPath(visualDirection.grand_design?.asset_path);
  for (const asset of workflow.assets) {
    addManagedPath(asset.candidate_path);
    addManagedPath(asset.registered_path);
    addManagedPath(asset.archived_path);
    for (const referencePath of asset.reference_paths) addManagedPath(referencePath);
  }

  const scannedImages = await scanImages(source, plan);
  const unmanagedItems = scannedImages
    .filter((filePath) => !managedPaths.has(comparisonKey(filePath)))
    .map((filePath): AssetInventoryItem => ({
      inventory_id: `unmanaged:${filePath}`,
      kind: 'unmanaged',
      asset_type: 'unmanaged',
      title: path.posix.basename(filePath),
      required: false,
      subject_ids: [],
      status: 'UNMANAGED',
      production_path: filePath,
      preview_path: filePath,
      issues: [{ code: 'UNMANAGED_IMAGE', message: 'Image is inside the configured scan scope but is not referenced by the Required Asset Plan, Canon, Approved Anchors, or workflow.', path: filePath }],
      workflow_assets: [],
      source_jobs: [],
    }));

  const assets = [...requiredItems, ...managedItems, ...unmanagedItems];
  return {
    plan: {
      metadata_path: ASSET_PLAN_PATH,
      available: true,
      version: plan.version,
      scan_roots: [...plan.scan.roots],
      ignore: [...plan.scan.ignore],
    },
    summary: summarize(assets),
    assets,
  };
}

async function reconcileRequiredAsset(
  definition: RequiredAssetDefinition,
  workflowAssets: ManagedVisualAssetSummary[],
  jobs: GenerationJobSummary[],
  exists: (path: string) => Promise<boolean>,
): Promise<AssetInventoryItem> {
  const registered = workflowAssets.filter((asset) => asset.status === 'registered');
  const candidates = workflowAssets.filter((asset) => asset.status === 'candidate' || asset.status === 'approved');
  const currentRegistered = registered.at(-1);
  const currentCandidate = candidates.at(-1);
  const issues: AssetInventoryIssue[] = [];
  const expectedProductionExists = await exists(definition.production_path);
  const knownJobIds = new Set(jobs.map((job) => job.job_id));

  for (const asset of workflowAssets) {
    if (asset.source_job_id && !knownJobIds.has(asset.source_job_id)) {
      issues.push({
        code: 'SOURCE_JOB_MISSING',
        message: 'Managed asset points to a Generation Job that does not exist in the workflow index.',
      });
    }
  }

  if (registered.length > 1) {
    issues.push({
      code: 'MULTIPLE_REGISTERED_ASSETS',
      message: 'More than one current Registered asset is associated with this Required Asset.',
      path: definition.production_path,
    });
  }
  for (const asset of registered) {
    if (!asset.registered_path) {
      issues.push({ code: 'REGISTERED_PATH_MISSING', message: 'Registered lifecycle state has no registered_path.' });
      continue;
    }
    if (comparisonKey(asset.registered_path) !== comparisonKey(definition.production_path)) {
      issues.push({
        code: 'REGISTERED_PATH_MISMATCH',
        message: 'Registered asset path does not match the Required Asset production_path.',
        path: asset.registered_path,
      });
    }
    if (!(await exists(asset.registered_path))) {
      issues.push({
        code: 'PRODUCTION_FILE_MISSING',
        message: 'Registered asset points to a production file that does not exist.',
        path: asset.registered_path,
      });
    }
  }
  for (const asset of candidates) {
    if (!asset.candidate_path) {
      issues.push({ code: 'CANDIDATE_PATH_MISSING', message: 'Candidate lifecycle state has no candidate_path.' });
      continue;
    }
    if (!(await exists(asset.candidate_path))) {
      issues.push({
        code: 'CANDIDATE_FILE_MISSING',
        message: 'Candidate lifecycle state points to a file that does not exist.',
        path: asset.candidate_path,
      });
    }
  }
  if (!registered.length && expectedProductionExists) {
    issues.push({
      code: 'PRODUCTION_NOT_REGISTERED',
      message: 'The expected production file exists but no matching Registered workflow asset exists.',
      path: definition.production_path,
    });
  }

  const status: AssetInventoryStatus = issues.length
    ? 'BROKEN'
    : currentCandidate
      ? 'REVIEW_REQUIRED'
      : currentRegistered
        ? 'READY'
        : 'MISSING';
  const candidatePath = currentCandidate?.candidate_path;
  const registeredPath = currentRegistered?.registered_path;
  const previewPath = candidatePath && await exists(candidatePath)
    ? candidatePath
    : registeredPath && await exists(registeredPath)
      ? registeredPath
      : expectedProductionExists
        ? definition.production_path
        : undefined;
  const sourceJobs = relatedJobs(definition.asset_id, workflowAssets, jobs);
  const currentLifecycle = currentCandidate?.status ?? currentRegistered?.status ?? workflowAssets.at(-1)?.status;

  return compactItem({
    inventory_id: `required:${definition.asset_id}`,
    kind: 'required',
    asset_id: definition.asset_id,
    asset_type: definition.asset_type,
    title: definition.title,
    required: definition.required,
    subject_ids: [...definition.subject_ids],
    status,
    production_path: definition.production_path,
    candidate_path: candidatePath,
    registered_path: registeredPath,
    preview_path: previewPath,
    current_lifecycle: currentLifecycle,
    required_definition: cloneRequiredDefinition(definition),
    issues,
    workflow_assets: workflowAssets.map(cloneWorkflowAsset),
    source_jobs: sourceJobs.map(cloneJob),
  });
}

async function reconcileUnplannedManagedAsset(
  asset: ManagedVisualAssetSummary,
  index: number,
  jobsById: Map<string, GenerationJobSummary>,
  planById: Map<string, RequiredAssetDefinition>,
  exists: (path: string) => Promise<boolean>,
): Promise<AssetInventoryItem> {
  const issues: AssetInventoryIssue[] = [];
  const sourceJob = asset.source_job_id ? jobsById.get(asset.source_job_id) : undefined;
  if (asset.source_job_id && !sourceJob) {
    issues.push({
      code: 'SOURCE_JOB_MISSING',
      message: 'Managed asset points to a Generation Job that does not exist in the workflow index.',
    });
  }
  for (const requiredAssetId of uniqueComparisonValues([asset.required_asset_id, sourceJob?.required_asset_id])) {
    if (!planById.has(comparisonKey(requiredAssetId))) {
      issues.push({
        code: 'REQUIRED_ASSET_NOT_IN_PLAN',
        message: `Workflow required_asset_id is not declared in ${ASSET_PLAN_PATH}.`,
      });
    }
  }
  const repositoryPath = asset.registered_path ?? asset.candidate_path ?? asset.archived_path;
  const fileExists = repositoryPath ? await exists(repositoryPath) : false;
  let status: AssetInventoryStatus;
  if (asset.status === 'registered') status = fileExists ? 'READY' : 'BROKEN';
  else if (asset.status === 'candidate' || asset.status === 'approved') status = fileExists ? 'REVIEW_REQUIRED' : 'BROKEN';
  else status = repositoryPath && !fileExists ? 'BROKEN' : 'SUPERSEDED';
  if (!repositoryPath) {
    issues.push({ code: 'WORKFLOW_PATH_MISSING', message: `Workflow asset in ${asset.status} state has no repository image path.` });
  } else if (!fileExists) {
    issues.push({ code: 'WORKFLOW_FILE_MISSING', message: `Workflow asset in ${asset.status} state points to a file that does not exist.`, path: repositoryPath });
  }
  if (issues.length && status !== 'SUPERSEDED') status = 'BROKEN';
  return compactItem({
    inventory_id: `managed:${asset.asset_id}:${index}`,
    kind: 'managed',
    asset_id: asset.asset_id,
    asset_type: asset.asset_type,
    title: asset.asset_id,
    required: false,
    subject_ids: asset.subject_id ? [asset.subject_id] : [...(sourceJob?.subject_ids ?? [])],
    status,
    production_path: asset.registered_path,
    candidate_path: asset.candidate_path,
    registered_path: asset.registered_path,
    preview_path: fileExists ? repositoryPath : undefined,
    current_lifecycle: asset.status,
    issues,
    workflow_assets: [cloneWorkflowAsset(asset)],
    source_jobs: sourceJob ? [cloneJob(sourceJob)] : [],
  });
}

async function scanImages(source: RepositorySource, plan: RequiredAssetPlan): Promise<string[]> {
  if (!plan.scan.roots.length) return [];
  if (!source.listFiles) {
    throw new VisualDirectorError(
      'ASSET_SCAN_UNSUPPORTED',
      'The repository source cannot enumerate the Required Asset Plan scan roots.',
      { path: ASSET_PLAN_PATH, scan_roots: plan.scan.roots },
    );
  }
  const ignore = plan.scan.ignore.map(globPattern);
  const files = new Map<string, string>();
  for (const root of plan.scan.roots) {
    for (const rawPath of await source.listFiles(root)) {
      let filePath: string;
      try {
        filePath = safeRepositoryPath(rawPath, 'scan result');
      } catch (error) {
        throw new VisualDirectorError('ASSET_SCAN_FAILED', 'Repository asset scan returned an unsafe path.', {
          path: rawPath,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      if (!isImagePath(filePath) || ignore.some((pattern) => pattern.test(filePath))) continue;
      files.set(comparisonKey(filePath), filePath);
    }
  }
  return [...files.values()].sort((left, right) => left.localeCompare(right));
}

function relatedJobs(
  requiredAssetId: string,
  workflowAssets: ManagedVisualAssetSummary[],
  jobs: GenerationJobSummary[],
): GenerationJobSummary[] {
  const jobIds = new Set(workflowAssets.flatMap((asset) => asset.source_job_id ? [asset.source_job_id] : []));
  return jobs.filter((job) => job.required_asset_id === requiredAssetId || jobIds.has(job.job_id));
}

function summarize(items: AssetInventoryItem[]): ProjectAssetInventory['summary'] {
  const summary = emptySummary();
  for (const item of items) {
    const counts = summary.by_asset_type[item.asset_type] ?? emptyTypeCounts();
    summary.by_asset_type[item.asset_type] = counts;
    if (item.kind === 'required') {
      if (item.required) {
        summary.total_required += 1;
        counts.required += 1;
        if (item.status === 'READY') { summary.ready += 1; counts.ready += 1; }
        if (item.status === 'REVIEW_REQUIRED') { summary.review_required += 1; counts.review_required += 1; }
        if (item.status === 'MISSING') { summary.missing += 1; counts.missing += 1; }
        if (item.status === 'BROKEN') { summary.broken += 1; counts.broken += 1; }
      } else {
        summary.total_optional += 1;
        counts.optional += 1;
      }
    } else if (item.kind === 'unmanaged') {
      summary.unmanaged += 1;
      counts.unmanaged += 1;
    } else {
      summary.managed_unplanned += 1;
      counts.managed_unplanned += 1;
    }
  }
  return summary;
}

function emptySummary(): ProjectAssetInventory['summary'] {
  return {
    total_required: 0,
    total_optional: 0,
    ready: 0,
    review_required: 0,
    missing: 0,
    broken: 0,
    unmanaged: 0,
    managed_unplanned: 0,
    by_asset_type: {},
  };
}

function emptyTypeCounts(): AssetInventoryTypeCounts {
  return { required: 0, optional: 0, ready: 0, review_required: 0, missing: 0, broken: 0, unmanaged: 0, managed_unplanned: 0 };
}

function createExistenceReader(source: RepositorySource): (path: string) => Promise<boolean> {
  const cache = new Map<string, Promise<boolean>>();
  return (repositoryPath: string) => {
    const key = comparisonKey(repositoryPath);
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = source.fileExists(repositoryPath);
    cache.set(key, pending);
    return pending;
  };
}

function globPattern(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] as string;
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else source += '.*';
      } else source += '[^/]*';
    } else if (character === '?') source += '[^/]';
    else source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${source}$`, 'i');
}

function comparisonKey(value: string): string {
  return value.replace(/\\/g, '/').normalize('NFKC').toLocaleLowerCase('en-US');
}

function uniqueComparisonValues(values: Array<string | undefined>): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    if (value) unique.set(comparisonKey(value), value);
  }
  return [...unique.values()];
}

function cloneRequiredDefinition(definition: RequiredAssetDefinition): RequiredAssetDefinition {
  return {
    ...definition,
    subject_ids: [...definition.subject_ids],
    ...(definition.generation ? { generation: { ...definition.generation, requirements: [...definition.generation.requirements] } } : {}),
  };
}

function cloneWorkflowAsset(asset: ManagedVisualAssetSummary): ManagedVisualAssetSummary {
  return { ...asset, reference_paths: [...asset.reference_paths] };
}

function cloneJob(job: GenerationJobSummary): GenerationJobSummary {
  return { ...job, subject_ids: [...job.subject_ids] };
}

function compactItem(item: AssetInventoryItem): AssetInventoryItem {
  return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)) as unknown as AssetInventoryItem;
}
