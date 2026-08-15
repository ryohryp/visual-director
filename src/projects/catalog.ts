import { readFileSync } from 'node:fs';

import { VisualDirectorError } from '../domain/types.js';
import type { ProjectVisualOverview } from '../domain/types.js';

export type ProjectAdapterType = 'bottom-of-thirst' | 'generic';

export interface ProjectCatalogEntry {
  project_id: string;
  display_name: string;
  repository: {
    owner: string;
    name: string;
  };
  ref: string;
  adapter_type: ProjectAdapterType;
}

export interface ProjectSummary {
  project_id: string;
  display_name: string;
  repository: string;
  ref: string;
  adapter_type: ProjectAdapterType;
  thumbnail: string | null;
  anchors: number;
  candidates: number;
  jobs: number;
  failed_jobs: number;
  repository_status: 'ready';
}

export interface ProjectCatalog {
  list(): readonly ProjectCatalogEntry[];
  resolve(projectId: string): ProjectCatalogEntry;
}

interface RawCatalog {
  projects?: unknown;
}

export function loadProjectCatalog(filePath: string): ProjectCatalog {
  const trimmedPath = filePath.trim();
  if (!trimmedPath) {
    throw new VisualDirectorError('PROJECT_CATALOG_INVALID', 'Project Catalog path must not be empty.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(trimmedPath, 'utf8'));
  } catch (error) {
    throw new VisualDirectorError('PROJECT_CATALOG_INVALID', 'Project Catalog could not be read.', {
      path: trimmedPath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return parseProjectCatalog(parsed);
}

export function parseProjectCatalog(input: unknown): ProjectCatalog {
  if (!isRecord(input) || !Array.isArray((input as RawCatalog).projects)) {
    throw new VisualDirectorError('PROJECT_CATALOG_INVALID', 'Project Catalog must contain a projects array.');
  }

  const entries = (input as { projects: unknown[] }).projects.map((value, index) => normalizeEntry(value, index));
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.project_id)) {
      throw new VisualDirectorError('PROJECT_CATALOG_DUPLICATE', `Project Catalog contains duplicate project_id: ${entry.project_id}.`, {
        project_id: entry.project_id,
      });
    }
    ids.add(entry.project_id);
  }

  return createProjectCatalog(entries);
}

export function createProjectCatalog(entries: readonly ProjectCatalogEntry[]): ProjectCatalog {
  const copied = entries.map((entry) => ({ ...entry, repository: { ...entry.repository } }));
  const byId = new Map(copied.map((entry) => [entry.project_id, entry]));
  if (byId.size !== copied.length) {
    throw new VisualDirectorError('PROJECT_CATALOG_DUPLICATE', 'Project Catalog contains duplicate project ids.');
  }
  return {
    list: () => copied,
    resolve(projectId: string): ProjectCatalogEntry {
      const normalized = projectId.trim();
      const entry = byId.get(normalized);
      if (!entry) {
        throw new VisualDirectorError('PROJECT_NOT_FOUND', `Unknown project_id: ${projectId}.`, {
          known_project_ids: [...byId.keys()],
        });
      }
      return entry;
    },
  };
}

export function summarizeProject(entry: ProjectCatalogEntry, overview: ProjectVisualOverview): ProjectSummary {
  if (overview.project_id !== entry.project_id) {
    throw new VisualDirectorError('PROJECT_SUMMARY_MISMATCH', 'Project overview does not belong to the requested catalog entry.', {
      expected_project_id: entry.project_id,
      actual_project_id: overview.project_id,
    });
  }
  const thumbnail = overview.visual_direction.grand_design?.asset_path
    ?? overview.visual_direction.global_style.asset_path
    ?? null;
  return {
    project_id: entry.project_id,
    display_name: entry.display_name,
    repository: `${entry.repository.owner}/${entry.repository.name}`,
    ref: entry.ref,
    adapter_type: entry.adapter_type,
    thumbnail,
    anchors: overview.approved_anchors.length,
    candidates: overview.workflow.assets.filter((asset) => asset.status === 'candidate').length,
    jobs: overview.workflow.jobs.length,
    failed_jobs: overview.workflow.jobs.filter((job) => job.status === 'failed').length,
    repository_status: 'ready',
  };
}

function normalizeEntry(value: unknown, index: number): ProjectCatalogEntry {
  if (!isRecord(value)) {
    throw new VisualDirectorError('PROJECT_CATALOG_INVALID', `Project Catalog entry ${index} must be an object.`);
  }
  const projectId = required(value.project_id, `projects[${index}].project_id`);
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(projectId)) {
    throw new VisualDirectorError('PROJECT_CATALOG_INVALID', `Invalid project_id: ${projectId}.`, { project_id: projectId });
  }
  const repository = required(value.repository, `projects[${index}].repository`);
  const slash = repository.indexOf('/');
  if (slash <= 0 || slash !== repository.lastIndexOf('/') || slash === repository.length - 1) {
    throw new VisualDirectorError('PROJECT_CATALOG_INVALID', 'repository must be in owner/name form.', { repository });
  }
  const adapterType = required(value.adapter_type, `projects[${index}].adapter_type`);
  if (adapterType !== 'bottom-of-thirst' && adapterType !== 'generic') {
    throw new VisualDirectorError('PROJECT_CATALOG_INVALID', `Unsupported adapter_type: ${adapterType}.`, { adapter_type: adapterType });
  }
  return {
    project_id: projectId,
    display_name: required(value.display_name, `projects[${index}].display_name`),
    repository: { owner: repository.slice(0, slash), name: repository.slice(slash + 1) },
    ref: required(value.ref, `projects[${index}].ref`),
    adapter_type: adapterType,
  };
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new VisualDirectorError('PROJECT_CATALOG_INVALID', `${field} must be a non-empty string.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
