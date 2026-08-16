import { VisualDirectorError } from '../domain/types.js';
import type { ProjectAdapter } from '../domain/types.js';
import { BottomOfThirstVisualAdapter } from './bottom-of-thirst/visual-adapter.js';
import { loadProjectCatalog } from './catalog.js';
import type { ProjectCatalog, ProjectCatalogEntry } from './catalog.js';
import { CanonProjectAdapter, DEFAULT_PROJECT_DOCUMENTS, DEFAULT_PROJECT_LABELS } from './canon/adapter.js';
import { GitHubRepositorySource } from './repository-source.js';
import type { RepositorySource } from './repository-source.js';

const DEFAULT_PROJECT_CATALOG_PATH = 'projects.catalog.json';

export interface CatalogRuntimeOptions {
  projectCatalog?: ProjectCatalog;
  projectCatalogPath?: string;
  fetchImpl?: typeof fetch;
}

export interface CatalogProjectRuntime {
  entry: ProjectCatalogEntry;
  source: RepositorySource;
  adapter: ProjectAdapter;
}

export function resolveProjectCatalog(options: CatalogRuntimeOptions = {}): ProjectCatalog {
  if (options.projectCatalog) return options.projectCatalog;
  const path = options.projectCatalogPath?.trim()
    || process.env.VISUAL_DIRECTOR_PROJECT_CATALOG?.trim()
    || DEFAULT_PROJECT_CATALOG_PATH;
  return loadProjectCatalog(path);
}

export function resolveCatalogEntry(projectId: string, options: CatalogRuntimeOptions = {}): ProjectCatalogEntry {
  const normalized = projectId.trim();
  if (!normalized) throw new VisualDirectorError('INVALID_INPUT', 'project_id is required.');
  return resolveProjectCatalog(options).resolve(normalized);
}

export function createCatalogRepositorySource(
  entry: ProjectCatalogEntry,
  options: CatalogRuntimeOptions = {},
): RepositorySource {
  const token = process.env.VISUAL_DIRECTOR_GITHUB_TOKEN?.trim();
  if (!token) {
    throw new VisualDirectorError('PROJECT_CONFIG_MISSING', 'VISUAL_DIRECTOR_GITHUB_TOKEN is required to read catalog repositories.', {
      project_id: entry.project_id,
    });
  }
  return new GitHubRepositorySource({
    owner: entry.repository.owner,
    repo: entry.repository.name,
    ref: entry.ref,
    token,
    fetchImpl: options.fetchImpl,
  });
}

export function createCatalogProjectAdapter(entry: ProjectCatalogEntry, source: RepositorySource): ProjectAdapter {
  if (entry.adapter_type === 'bottom-of-thirst') return new BottomOfThirstVisualAdapter({ source });
  return new CanonProjectAdapter({
    projectId: entry.project_id,
    documents: { ...DEFAULT_PROJECT_DOCUMENTS },
    labels: { ...DEFAULT_PROJECT_LABELS },
    subjects: {},
  }, { source });
}

export function resolveCatalogProjectRuntime(
  projectId: string,
  options: CatalogRuntimeOptions = {},
): CatalogProjectRuntime {
  const entry = resolveCatalogEntry(projectId, options);
  const source = createCatalogRepositorySource(entry, options);
  return { entry, source, adapter: createCatalogProjectAdapter(entry, source) };
}
