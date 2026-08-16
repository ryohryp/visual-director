import { VisualDirectorError } from '../domain/types.js';
import type {
  AdoptAnchorInput,
  AdoptAnchorResult,
  CandidateWorkflowResult,
  GenerateImageInput,
  GenerateImageResult,
  GenerationPackage,
  PrepareGenerationInput,
  ProjectVisualOverview,
  ProjectVisualOverviewInput,
  RegisterCandidateInput,
  ReviewCandidateInput,
} from '../domain/types.js';
import type { ImageGenerator } from '../generators/types.js';
import { OpenAIImageGenerator } from '../generators/openai-image-generator.js';
import { summarizeProject, summarizeUnavailableProject } from '../projects/catalog.js';
import type { ProjectCatalog, ProjectCatalogEntry, ProjectSummary } from '../projects/catalog.js';
import {
  createCatalogProjectAdapter,
  createCatalogRepositorySource,
  resolveProjectCatalog as resolveRuntimeProjectCatalog,
} from '../projects/catalog-runtime.js';
import { CanonProjectAdapter } from '../projects/canon/adapter.js';
import { loadRepositoryCanonDefinition } from '../projects/canon/repository-manifest.js';
import { diagnoseProjectRepository } from '../projects/diagnostics.js';
import type { ProjectDiagnostics } from '../projects/diagnostics.js';
import { createProjectRegistry } from '../projects/registry.js';
import type { ProjectConfiguration, ProjectRegistry, ProjectRegistryOptions } from '../projects/registry.js';
import { LocalRepositorySource } from '../projects/repository-source.js';
import type { RepositorySource } from '../projects/repository-source.js';
import { registerCandidate, reviewCandidate } from '../projects/workflow-store.js';
import { runImageGeneration } from './image-generation-service.js';

export type VisualDirectorCoreOptions = ProjectRegistryOptions & {
  imageGenerator?: ImageGenerator;
  projectCatalog?: ProjectCatalog;
  projectCatalogPath?: string;
  projectOverviewLoader?: (entry: ProjectCatalogEntry) => Promise<ProjectVisualOverview>;
  projectDiagnosticsLoader?: (entry: ProjectCatalogEntry) => Promise<ProjectDiagnostics>;
};

export interface VisualDirectorCore {
  prepareGeneration(input: PrepareGenerationInput): Promise<GenerationPackage>;
  generateImage(input: GenerateImageInput): Promise<GenerateImageResult>;
  getProjectVisualOverview(input: ProjectVisualOverviewInput): Promise<ProjectVisualOverview>;
  listProjects(): Promise<ProjectSummary[]>;
  registerCandidate(input: RegisterCandidateInput): Promise<CandidateWorkflowResult>;
  reviewCandidate(input: ReviewCandidateInput): Promise<CandidateWorkflowResult>;
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
        const adapter = await localRepositoryAdapter(input.project_id, repositoryPath);
        return adapter.prepare(stripRepositoryPath(input));
      }

      try {
        return await registry.resolve(input.project_id).prepare(input);
      } catch (error) {
        if (!(error instanceof VisualDirectorError)
          || (error.code !== 'PROJECT_CONFIG_MISSING' && error.code !== 'PROJECT_NOT_FOUND')) throw error;
        const adapter = await catalogAdapterForProject(input.project_id, options);
        return adapter.prepare(input);
      }
    },

    async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
      if (isHostedReadOnlyMode()) throw hostedWorkflowWriteDisabled(input.project_id);
      const adapter = await localRepositoryAdapter(input.project_id, input.repository_path);
      const generationPackage = await adapter.prepare({
        project_id: input.project_id,
        asset_type: input.asset_type,
        subject_ids: [...input.subject_ids],
        request_text: input.request_text,
        ...(input.scene_context ? { scene_context: { ...input.scene_context } } : {}),
      });
      return runImageGeneration({
        request: input,
        generationPackage,
        generator: options.imageGenerator ?? new OpenAIImageGenerator({ fetchImpl: options.fetchImpl }),
      });
    },

    async getProjectVisualOverview(input: ProjectVisualOverviewInput): Promise<ProjectVisualOverview> {
      const repositoryPath = input.repository_path?.trim();
      if (input.repository_path !== undefined && !repositoryPath) {
        throw new VisualDirectorError(
          'PROJECT_CONFIG_INVALID',
          'repository_path must be a non-empty string when supplied for visual overview resolution.',
          { project_id: input.project_id },
        );
      }
      if (repositoryPath) {
        return (await localRepositoryAdapter(input.project_id, repositoryPath)).getVisualOverview();
      }

      try {
        return await registry.resolve(input.project_id).getVisualOverview();
      } catch (error) {
        if (!(error instanceof VisualDirectorError)
          || (error.code !== 'PROJECT_CONFIG_MISSING' && error.code !== 'PROJECT_NOT_FOUND')) throw error;
        const adapter = await catalogAdapterForProject(input.project_id, options);
        return adapter.getVisualOverview();
      }
    },

    async listProjects(): Promise<ProjectSummary[]> {
      const catalog = resolveRuntimeProjectCatalog(options);
      return Promise.all(catalog.list().map(async (entry) => {
        const loadOverview = () => options.projectOverviewLoader
          ? options.projectOverviewLoader(entry)
          : loadCatalogOverview(entry, options);

        if (options.projectOverviewLoader && !options.projectDiagnosticsLoader) {
          return summarizeProject(entry, await loadOverview());
        }

        const diagnostics = options.projectDiagnosticsLoader
          ? await options.projectDiagnosticsLoader(entry)
          : await loadCatalogDiagnostics(entry, options, loadOverview);
        if (!diagnostics.usable) return summarizeUnavailableProject(entry, diagnostics);
        return summarizeProject(entry, await loadOverview(), diagnostics);
      }));
    },

    async registerCandidate(input: RegisterCandidateInput): Promise<CandidateWorkflowResult> {
      if (isHostedReadOnlyMode()) throw hostedWorkflowWriteDisabled(input.project_id);
      await validateWorkflowRepository(options, input.project_id, input.repository_path);
      return registerCandidate(input);
    },

    async reviewCandidate(input: ReviewCandidateInput): Promise<CandidateWorkflowResult> {
      if (isHostedReadOnlyMode()) throw hostedWorkflowWriteDisabled(input.project_id);
      await validateWorkflowRepository(options, input.project_id, input.repository_path);
      return reviewCandidate(input);
    },

    configureProject(projectId: string, repositoryPath: string): Promise<ProjectConfiguration> {
      return registry.configureProject(projectId, repositoryPath);
    },

    adoptAnchor(input: AdoptAnchorInput): Promise<AdoptAnchorResult> {
      if (isHostedReadOnlyMode()) {
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

async function localRepositoryAdapter(projectId: string, repositoryPath: string): Promise<CanonProjectAdapter> {
  const source = new LocalRepositorySource(repositoryPath);
  const definition = await loadRepositoryCanonDefinition(source);
  if (definition.projectId !== projectId.trim()) {
    throw new VisualDirectorError('PROJECT_MANIFEST_INVALID', 'Project manifest project_id does not match requested project_id.', {
      requested_project_id: projectId,
      manifest_project_id: definition.projectId,
    });
  }
  return new CanonProjectAdapter(definition, { source });
}

async function catalogAdapterForProject(projectId: string, options: VisualDirectorCoreOptions) {
  const entry = resolveRuntimeProjectCatalog(options).resolve(projectId);
  const source = createCatalogRepositorySource(entry, options);
  return createCatalogProjectAdapter(entry, source);
}

async function loadCatalogDiagnostics(
  entry: ProjectCatalogEntry,
  options: VisualDirectorCoreOptions,
  loadOverview: () => Promise<ProjectVisualOverview>,
): Promise<ProjectDiagnostics> {
  const source = catalogRepositorySource(entry, options);
  return diagnoseProjectRepository(entry, source, loadOverview);
}

async function loadCatalogOverview(
  entry: ProjectCatalogEntry,
  options: VisualDirectorCoreOptions,
): Promise<ProjectVisualOverview> {
  const adapter = await createCatalogProjectAdapter(entry, catalogRepositorySource(entry, options));
  return adapter.getVisualOverview();
}

function catalogRepositorySource(entry: ProjectCatalogEntry, options: VisualDirectorCoreOptions): RepositorySource {
  return createCatalogRepositorySource(entry, options);
}

async function validateWorkflowRepository(
  options: VisualDirectorCoreOptions,
  projectId: string,
  repositoryPath: string,
): Promise<void> {
  const requestRegistry = createProjectRegistry(options);
  await requestRegistry.configureProject(projectId, repositoryPath);
}

function hostedWorkflowWriteDisabled(projectId: string): VisualDirectorError {
  return new VisualDirectorError(
    'HOSTED_WRITE_DISABLED',
    'Candidate workflow mutations and image generation are disabled in hosted read-only mode pending a separately reviewed repository write path.',
    { project_id: projectId },
  );
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
