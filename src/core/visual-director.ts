import { VisualDirectorError } from '../domain/types.js';
import type { AdoptAnchorInput, AdoptAnchorResult, GenerationPackage, PrepareGenerationInput } from '../domain/types.js';
import { BottomOfThirstAdapter } from '../projects/bottom-of-thirst/adapter.js';
import { createProjectRegistry } from '../projects/registry.js';
import type { ProjectConfiguration, ProjectRegistry, ProjectRegistryOptions } from '../projects/registry.js';
import { GitHubRepositorySource } from '../projects/repository-source.js';

export type VisualDirectorCoreOptions = ProjectRegistryOptions;

export interface VisualDirectorCore {
  prepareGeneration(input: PrepareGenerationInput): Promise<GenerationPackage>;
  configureProject(projectId: string, repositoryPath: string): Promise<ProjectConfiguration>;
  adoptAnchor(input: AdoptAnchorInput): Promise<AdoptAnchorResult>;
}

export function createVisualDirectorCore(
  options: VisualDirectorCoreOptions = {},
  registry: ProjectRegistry = createProjectRegistry(options),
): VisualDirectorCore {
  return {
    async prepareGeneration(input: PrepareGenerationInput): Promise<GenerationPackage> {
      const repositoryPath = repositoryPathFromSceneContext(input);
      if (repositoryPath) {
        // Explicit repository_path is request-scoped. Use a fresh registry so preparation
        // does not depend on, or mutate, an MCP/session runtime binding.
        const requestRegistry = createProjectRegistry(options);
        await requestRegistry.configureProject(input.project_id, repositoryPath);
        return requestRegistry.resolve(input.project_id).prepare(stripRepositoryPath(input));
      }

      try {
        return await registry.resolve(input.project_id).prepare(input);
      } catch (error) {
        if (!(error instanceof VisualDirectorError) || error.code !== 'PROJECT_CONFIG_MISSING') throw error;
        const hostedAdapter = hostedAdapterFromEnvironment(input.project_id, options.fetchImpl);
        if (!hostedAdapter) throw error;
        return hostedAdapter.prepare(input);
      }
    },

    configureProject(projectId: string, repositoryPath: string): Promise<ProjectConfiguration> {
      return registry.configureProject(projectId, repositoryPath);
    },

    adoptAnchor(input: AdoptAnchorInput): Promise<AdoptAnchorResult> {
      if (isHostedReadOnlyMode() && hostedAdapterFromEnvironment(input.project_id, options.fetchImpl)) {
        return Promise.reject(new VisualDirectorError(
          'HOSTED_WRITE_DISABLED',
          'visual.adopt_anchor is disabled in hosted read-only mode. Adopt Anchors through a separately reviewed write path.',
          { project_id: input.project_id },
        ));
      }
      return registry.adoptAnchor(input);
    },
  };
}

function hostedAdapterFromEnvironment(projectId: string, fetchImpl?: typeof fetch): BottomOfThirstAdapter | undefined {
  if (projectId !== 'bottom-of-thirst') return undefined;
  const token = process.env.VISUAL_DIRECTOR_GITHUB_TOKEN?.trim();
  if (!token) return undefined;

  const repository = process.env.VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REPO?.trim() || 'ryohryp/---The-Bottom-of-Thirst';
  const slash = repository.indexOf('/');
  if (slash <= 0 || slash === repository.length - 1) {
    throw new VisualDirectorError(
      'PROJECT_CONFIG_INVALID',
      'VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REPO must be in owner/repo form.',
    );
  }
  const owner = repository.slice(0, slash);
  const repo = repository.slice(slash + 1);
  const ref = process.env.VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REF?.trim() || 'main';
  const source = new GitHubRepositorySource({ owner, repo, ref, token, fetchImpl });
  return new BottomOfThirstAdapter({ source });
}

function isHostedReadOnlyMode(): boolean {
  return process.env.VERCEL === '1' || process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY === '1';
}

function repositoryPathFromSceneContext(input: PrepareGenerationInput): string | undefined {
  const sceneContext = input.scene_context;
  if (!sceneContext || !Object.prototype.hasOwnProperty.call(sceneContext, 'repository_path')) {
    return undefined;
  }

  const repositoryPath = sceneContext.repository_path;
  if (typeof repositoryPath !== 'string' || !repositoryPath.trim()) {
    throw new VisualDirectorError(
      'PROJECT_CONFIG_INVALID',
      'scene_context.repository_path must be a non-empty string when used as a request-scoped repository binding.',
      { project_id: input.project_id },
    );
  }
  return repositoryPath.trim();
}

function stripRepositoryPath(input: PrepareGenerationInput): PrepareGenerationInput {
  const sceneContext = { ...(input.scene_context ?? {}) };
  delete sceneContext.repository_path;

  const cleanInput: PrepareGenerationInput = {
    project_id: input.project_id,
    asset_type: input.asset_type,
    subject_ids: [...input.subject_ids],
    request_text: input.request_text,
  };
  if (Object.keys(sceneContext).length > 0) cleanInput.scene_context = sceneContext;
  return cleanInput;
}
