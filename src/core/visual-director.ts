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
import { BottomOfThirstAdapter } from '../projects/bottom-of-thirst/adapter.js';
import { BottomOfThirstVisualAdapter } from '../projects/bottom-of-thirst/visual-adapter.js';
import {
  createProjectCatalog,
  loadProjectCatalog,
  summarizeProject,
} from '../projects/catalog.js';
import type { ProjectCatalog, ProjectCatalogEntry, ProjectSummary } from '../projects/catalog.js';
import {
  CanonProjectAdapter,
  DEFAULT_PROJECT_DOCUMENTS,
  DEFAULT_PROJECT_LABELS,
} from '../projects/canon/adapter.js';
import { createProjectRegistry } from '../projects/registry.js';
import type { ProjectConfiguration, ProjectRegistry, ProjectRegistryOptions } from '../projects/registry.js';
import { GitHubRepositorySource } from '../projects/repository-source.js';
import { registerCandidate, reviewCandidate } from '../projects/workflow-store.js';
import { runImageGeneration } from './image-generation-service.js';

export type VisualDirectorCoreOptions = ProjectRegistryOptions & {
  imageGenerator?: ImageGenerator;
  projectCatalog?: ProjectCatalog;
  projectCatalogPath?: string;
  projectOverviewLoader?: (entry: ProjectCatalogEntry) => Promise<ProjectVisualOverview>;
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

    async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
      if (isHostedReadOnlyMode()) throw hostedWorkflowWriteDisabled(input.project_id);
      const requestRegistry = createProjectRegistry(options);
      await requestRegistry.configureProject(input.project_id, input.repository_path);
      const generationPackage = await requestRegistry.resolve(input.project_id).prepare({
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
        if (input.project_id === 'bottom-of-thirst') {
          return new BottomOfThirstVisualAdapter({ repoPath: repositoryPath }).getVisualOverview();
        }
        const requestRegistry = createProjectRegistry(options);
        await requestRegistry.configureProject(input.project_id, repositoryPath);
        return requestRegistry.resolve(input.project_id).getVisualOverview();
      }

      try {
        return await registry.resolve(input.project_id).getVisualOverview();
      } catch (error) {
        if (!(error instanceof VisualDirectorError) || error.code !== 'PROJECT_CONFIG_MISSING') throw error;
        const hostedAdapter = hostedVisualAdapterFromEnvironment(input.project_id, options.fetchImpl);
        if (!hostedAdapter) throw error;
        return hostedAdapter.getVisualOverview();
      }
    },

    async listProjects(): Promise<ProjectSummary[]> {
      const catalog = resolveProjectCatalog(options);
      const loadOverview = options.projectOverviewLoader ?? ((entry: ProjectCatalogEntry) => loadCatalogOverview(entry, options));
      return Promise.all(catalog.list().map(async (entry) => summarizeProject(entry, await loadOverview(entry))));
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

function resolveProjectCatalog(options: VisualDirectorCoreOptions): ProjectCatalog {
  if (options.projectCatalog) return options.projectCatalog;
  const catalogPath = options.projectCatalogPath?.trim() || process.env.VISUAL_DIRECTOR_PROJECT_CATALOG?.trim();
  if (catalogPath) return loadProjectCatalog(catalogPath);
  throw new VisualDirectorError(
    'PROJECT_CATALOG_MISSING',
    'No Project Catalog is configured. Set VISUAL_DIRECTOR_PROJECT_CATALOG or pass projectCatalog/projectCatalogPath.',
  );
}

async function loadCatalogOverview(
  entry: ProjectCatalogEntry,
  options: VisualDirectorCoreOptions,
): Promise<ProjectVisualOverview> {
  const token = process.env.VISUAL_DIRECTOR_GITHUB_TOKEN?.trim();
  if (!token) {
    throw new VisualDirectorError('PROJECT_CONFIG_MISSING', 'VISUAL_DIRECTOR_GITHUB_TOKEN is required to read catalog repositories.', {
      project_id: entry.project_id,
    });
  }
  const source = new GitHubRepositorySource({
    owner: entry.repository.owner,
    repo: entry.repository.name,
    ref: entry.ref,
    token,
    fetchImpl: options.fetchImpl,
  });
  if (entry.adapter_type === 'bottom-of-thirst') {
    return new BottomOfThirstVisualAdapter({ source }).getVisualOverview();
  }
  const definition = {
    projectId: entry.project_id,
    documents: { ...DEFAULT_PROJECT_DOCUMENTS },
    labels: { ...DEFAULT_PROJECT_LABELS },
    subjects: {},
  };
  return new CanonProjectAdapter(definition, { source }).getVisualOverview();
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

function hostedAdapterFromEnvironment(projectId: string, fetchImpl?: typeof fetch): BottomOfThirstAdapter | undefined {
  const source = hostedSourceFromEnvironment(projectId, fetchImpl);
  return source ? new BottomOfThirstAdapter({ source }) : undefined;
}

function hostedVisualAdapterFromEnvironment(projectId: string, fetchImpl?: typeof fetch): BottomOfThirstVisualAdapter | undefined {
  const source = hostedSourceFromEnvironment(projectId, fetchImpl);
  return source ? new BottomOfThirstVisualAdapter({ source }) : undefined;
}

function hostedSourceFromEnvironment(projectId: string, fetchImpl?: typeof fetch): GitHubRepositorySource | undefined {
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
  return new GitHubRepositorySource({ owner, repo, ref, token, fetchImpl });
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
