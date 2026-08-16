import { VisualDirectorError } from '../domain/types.js';
import type { ProjectAdapter } from '../domain/types.js';
import { loadProjectCatalog } from './catalog.js';
import type { ProjectCatalog, ProjectCatalogEntry } from './catalog.js';
import { CanonProjectAdapter } from './canon/adapter.js';
import { loadRepositoryCanonDefinition } from './canon/repository-manifest.js';
import { createRegisteredLocalRepositorySource } from './project-registry.js';
import { GitHubRepositorySource } from './repository-source.js';
import type { RepositorySource } from './repository-source.js';

const DEFAULT_PROJECT_CATALOG_PATH = 'projects.catalog.json';

export interface CatalogRuntimeOptions {
  projectCatalog?: ProjectCatalog;
  projectCatalogPath?: string;
  fetchImpl?: typeof fetch;
  repositoryMode?: 'github' | 'local';
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
  const mode = options.repositoryMode ?? (process.env.VISUAL_DIRECTOR_REPOSITORY_MODE === 'local' ? 'local' : 'github');
  if (mode === 'local') return createRegisteredLocalRepositorySource(entry.project_id);

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

export async function createCatalogProjectAdapter(entry: ProjectCatalogEntry, source: RepositorySource): Promise<ProjectAdapter> {
  const definition = await loadRepositoryCanonDefinition(source);
  if (definition.projectId !== entry.project_id) {
    throw new VisualDirectorError('PROJECT_MANIFEST_INVALID', 'Project manifest project_id does not match catalog project_id.', {
      catalog_project_id: entry.project_id,
      manifest_project_id: definition.projectId,
    });
  }
  return new CanonProjectAdapter(definition, { source });
}

export async function resolveCatalogProjectRuntime(
  projectId: string,
  options: CatalogRuntimeOptions = {},
): Promise<CatalogProjectRuntime> {
  const entry = resolveCatalogEntry(projectId, options);
  const source = createCatalogRepositorySource(entry, options);
  const adapter = await createCatalogProjectAdapter(entry, source);
  return { entry, source, adapter };
}
