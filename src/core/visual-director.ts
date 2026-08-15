import { VisualDirectorError } from '../domain/types.js';
import type { AdoptAnchorInput, AdoptAnchorResult, GenerationPackage, PrepareGenerationInput } from '../domain/types.js';
import { createProjectRegistry } from '../projects/registry.js';
import type { ProjectConfiguration, ProjectRegistry, ProjectRegistryOptions } from '../projects/registry.js';

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
      if (!repositoryPath) {
        return registry.resolve(input.project_id).prepare(input);
      }

      // Explicit repository_path is request-scoped. Use a fresh registry so preparation
      // does not depend on, or mutate, an MCP/session runtime binding.
      const requestRegistry = createProjectRegistry(options);
      await requestRegistry.configureProject(input.project_id, repositoryPath);
      return requestRegistry.resolve(input.project_id).prepare(stripRepositoryPath(input));
    },

    configureProject(projectId: string, repositoryPath: string): Promise<ProjectConfiguration> {
      return registry.configureProject(projectId, repositoryPath);
    },

    adoptAnchor(input: AdoptAnchorInput): Promise<AdoptAnchorResult> {
      return registry.adoptAnchor(input);
    },
  };
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
