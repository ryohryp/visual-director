import { readFileSync } from 'node:fs';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { VisualDirectorError } from '../domain/types.js';
import type { ProjectAdapter } from '../domain/types.js';
import {
  CanonProjectAdapter,
  DEFAULT_PROJECT_DOCUMENTS,
  DEFAULT_PROJECT_LABELS,
} from './canon/adapter.js';
import type { CanonProjectDefinition, ProjectDocuments, ProjectLabels, ProjectSubjectDefinition } from './canon/adapter.js';
import { BottomOfThirstAdapter } from './bottom-of-thirst/adapter.js';
import { bottomOfThirstCanonSubject } from './bottom-of-thirst/adapter.js';
import type { AdoptAnchorInput, AdoptAnchorResult } from '../domain/types.js';
import { bottomOfThirstDefinition } from './definitions.js';
import { PersonalOrbitAdapter } from './personal-orbit/adapter.js';
import { personalOrbitDefinition } from './personal-orbit/definition.js';

export interface ProjectRegistryOptions {
  repoPath?: string;
  projectsConfigPath?: string;
}

export interface ProjectRegistry {
  configureProject(projectId: string, repositoryPath: string): Promise<ProjectConfiguration>;
  adoptAnchor(input: AdoptAnchorInput): Promise<AdoptAnchorResult>;
  resolve(projectId: string): ProjectAdapter;
}

export interface ProjectConfiguration {
  project_id: string;
  repository_path: string;
  persistence: 'runtime';
}

interface ProjectConfigFile {
  projects: Record<string, ProjectConfig>;
}

interface ProjectConfig {
  repo_path: string;
  documents?: Partial<ProjectDocumentsConfig>;
  labels?: Partial<ProjectLabelsConfig>;
  subjects: Record<string, ProjectSubjectConfig>;
}

interface ProjectDocumentsConfig {
  global_style: string;
  character_canon: string;
  world_direction: string;
  asset_manifest: string;
  global_reference: string;
}

interface ProjectLabelsConfig {
  avoid_block_heading: string;
  allowed_changes_heading: string;
  forbidden_changes_heading: string;
  common_rules_heading: string;
  accepted_conditions_heading: string;
}

interface ProjectSubjectConfig {
  display_name: string;
  character_file: string;
  canon_heading: string;
}

export function createProjectRegistry(options: ProjectRegistryOptions = {}): ProjectRegistry {
  const definitions = new Map<string, CanonProjectDefinition>([
    [bottomOfThirstDefinition.projectId, bottomOfThirstDefinition],
    [personalOrbitDefinition.projectId, personalOrbitDefinition],
  ]);
  const repoPaths = new Map<string, string>();
  if (options.repoPath) repoPaths.set(bottomOfThirstDefinition.projectId, options.repoPath);

  if (options.projectsConfigPath) {
    const config = readProjectConfig(options.projectsConfigPath);
    for (const [projectId, rawProjectConfig] of Object.entries(config.projects) as Array<[string, unknown]>) {
      if (definitions.has(projectId)) {
        throw new VisualDirectorError('PROJECT_CONFIG_INVALID', `Project is defined more than once: ${projectId}.`);
      }
      if (!isRecord(rawProjectConfig)) {
        throw new VisualDirectorError('PROJECT_CONFIG_INVALID', `Project ${projectId} must be an object.`);
      }
      const projectConfig = rawProjectConfig as unknown as ProjectConfig;
      definitions.set(projectId, normalizeDefinition(projectId, projectConfig));
      repoPaths.set(projectId, resolveConfigPath(options.projectsConfigPath, projectConfig.repo_path));
    }
  }

  return {
    async configureProject(projectId: string, repositoryPath: string): Promise<ProjectConfiguration> {
      if (!definitions.has(projectId)) {
        throw new VisualDirectorError('PROJECT_NOT_FOUND', `Unsupported project_id: ${projectId}.`, {
          known_project_ids: [...definitions.keys()],
        });
      }

      const trimmedPath = repositoryPath.trim();
      if (!trimmedPath) {
        throw new VisualDirectorError('PROJECT_CONFIG_INVALID', 'repository_path must not be empty.', {
          project_id: projectId,
        });
      }

      const resolvedPath = path.resolve(trimmedPath);
      let repositoryStats: Awaited<ReturnType<typeof stat>>;
      try {
        repositoryStats = await stat(resolvedPath);
      } catch (error) {
        throw new VisualDirectorError('PROJECT_REPOSITORY_INVALID', 'The configured repository path cannot be read.', {
          project_id: projectId,
          repository_path: resolvedPath,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      if (!repositoryStats.isDirectory()) {
        throw new VisualDirectorError('PROJECT_REPOSITORY_INVALID', 'The configured repository path must be a directory.', {
          project_id: projectId,
          repository_path: resolvedPath,
        });
      }

      repoPaths.set(projectId, resolvedPath);
      return { project_id: projectId, repository_path: resolvedPath, persistence: 'runtime' };
    },
    async adoptAnchor(input: AdoptAnchorInput): Promise<AdoptAnchorResult> {
      const definition = definitions.get(input.project_id);
      if (!definition) {
        throw new VisualDirectorError('PROJECT_NOT_FOUND', `Unsupported project_id: ${input.project_id}.`);
      }
      const repoPath = repoPaths.get(input.project_id) ?? process.env.BOTTOM_OF_THIRST_REPO_PATH;
      if (!repoPath) {
        throw new VisualDirectorError('PROJECT_CONFIG_MISSING', `No repository path is configured for project_id: ${input.project_id}.`);
      }
      const subject = input.project_id === bottomOfThirstDefinition.projectId
        ? bottomOfThirstCanonSubject(input.subject_id)
        : definition.subjects[input.subject_id.trim()];
      if (!subject) {
        throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${input.subject_id}.`);
      }
      const candidatePath = safeRepositoryRelativePath(input.candidate_path, 'candidate_path');
      const candidateAbsolutePath = path.resolve(repoPath, candidatePath);
      await ensureRegularFile(candidateAbsolutePath, 'ANCHOR_CANDIDATE_NOT_FOUND', candidatePath);
      const [realRepositoryPath, realCandidatePath] = await Promise.all([realpath(repoPath), realpath(candidateAbsolutePath)]);
      if (!isWithin(realRepositoryPath, realCandidatePath)) {
        throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'candidate_path resolves outside the configured repository.', {
          candidate_path: candidatePath,
        });
      }

      const canonPath = safeRepositoryRelativePath(definition.documents.characterCanon, 'character_canon');
      const canonAbsolutePath = path.resolve(repoPath, canonPath);
      let canonMarkdown: string;
      try {
        canonMarkdown = await readFile(canonAbsolutePath, 'utf8');
      } catch (error) {
        throw new VisualDirectorError('CANON_READ_FAILED', 'Could not read the character Visual Canon.', {
          path: canonPath,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      const updated = registerApprovedAnchor(canonMarkdown, subject.canonHeading, candidatePath);
      if (updated !== canonMarkdown) await writeFile(canonAbsolutePath, updated, 'utf8');
      return {
        project_id: input.project_id,
        subject_id: subject.id,
        approved_anchor_path: candidatePath,
        canon_path: canonPath,
        changed: updated !== canonMarkdown,
      };
    },
    resolve(projectId: string): ProjectAdapter {
      const definition = definitions.get(projectId);
      if (!definition) {
        throw new VisualDirectorError('PROJECT_NOT_FOUND', `Unsupported project_id: ${projectId}.`, {
          known_project_ids: [...definitions.keys()],
        });
      }
      const repoPath = repoPaths.get(projectId)
        ?? (projectId === bottomOfThirstDefinition.projectId ? process.env.BOTTOM_OF_THIRST_REPO_PATH : undefined);
      if (!repoPath) {
        throw new VisualDirectorError('PROJECT_CONFIG_MISSING', `No repository path is configured for project_id: ${projectId}.`, {
          project_id: projectId,
        });
      }
      if (projectId === bottomOfThirstDefinition.projectId) {
        return new BottomOfThirstAdapter({ repoPath });
      }
      if (projectId === personalOrbitDefinition.projectId) {
        return new PersonalOrbitAdapter(personalOrbitDefinition, { repoPath });
      }
      return new CanonProjectAdapter(definition, { repoPath });
    },
  };
}

function safeRepositoryRelativePath(value: string, field: string): string {
  const normalized = value.trim().replace(/\\/g, '/');
  if (!normalized || path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', `${field} must be a repository-relative path.`, { [field]: value });
  }
  return normalized.replace(/^\.\//, '');
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function ensureRegularFile(absolutePath: string, code: string, relativePath: string): Promise<void> {
  try {
    const fileStats = await stat(absolutePath);
    if (!fileStats.isFile()) throw new Error('Path is not a regular file.');
  } catch (error) {
    throw new VisualDirectorError(code, 'The approved Anchor candidate must be an existing repository file.', {
      path: relativePath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export function registerApprovedAnchor(markdown: string, canonHeading: string, anchorPath: string): string {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(canonHeading)}[ \\t]*$`, 'm');
  const headingMatch = headingPattern.exec(markdown);
  if (!headingMatch || headingMatch.index === undefined) {
    throw new VisualDirectorError('CANON_SUBJECT_NOT_FOUND', 'The subject section is missing from the character Visual Canon.', {
      canon_heading: canonHeading,
    });
  }
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const rest = markdown.slice(sectionStart);
  const nextHeadingOffset = rest.search(/^##\s+/m);
  const sectionEnd = nextHeadingOffset >= 0 ? sectionStart + nextHeadingOffset : markdown.length;
  const section = markdown.slice(sectionStart, sectionEnd);
  const approvedHeading = /^###\s+Approved Visual Anchor[ \t]*$/m.exec(section);
  if (approvedHeading?.index !== undefined) {
    const afterHeading = approvedHeading.index + approvedHeading[0].length;
    const approvedRest = section.slice(afterHeading);
    const nextSubheading = approvedRest.search(/^###\s+/m);
    const approvedEnd = nextSubheading >= 0 ? afterHeading + nextSubheading : section.length;
    const existing = section.slice(afterHeading, approvedEnd).match(/^\s*-\s+`([^`]+)`\s*$/m)?.[1];
    if (existing === anchorPath) return markdown;
    if (existing) {
      throw new VisualDirectorError('APPROVED_ANCHOR_CONFLICT', 'An Approved Visual Anchor is already registered for this subject.', {
        existing_path: existing,
        candidate_path: anchorPath,
      });
    }
    const insertionPoint = sectionStart + afterHeading;
    const entry = `${newline}- \`${anchorPath}\``;
    return markdown.slice(0, insertionPoint) + entry + markdown.slice(insertionPoint);
  }
  const insertion = `${newline}${newline}### Approved Visual Anchor${newline}- \`${anchorPath}\``;
  return markdown.slice(0, sectionStart) + insertion + markdown.slice(sectionStart);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readProjectConfig(configPath: string): ProjectConfigFile {
  const resolvedPath = path.resolve(configPath);
  let raw: string;
  try {
    raw = readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    throw new VisualDirectorError('PROJECT_CONFIG_INVALID', 'Could not read the Visual Director project config.', {
      path: resolvedPath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new VisualDirectorError('PROJECT_CONFIG_INVALID', 'Visual Director project config is not valid JSON.', {
      path: resolvedPath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (!isRecord(parsed) || !isRecord(parsed.projects)) {
    throw new VisualDirectorError('PROJECT_CONFIG_INVALID', 'Project config must contain a projects object.', { path: resolvedPath });
  }
  return parsed as unknown as ProjectConfigFile;
}

function normalizeDefinition(projectId: string, config: ProjectConfig): CanonProjectDefinition {
  if (!isRecord(config) || !isNonEmptyString(config.repo_path) || !isRecord(config.subjects) || Object.keys(config.subjects).length === 0) {
    throw new VisualDirectorError('PROJECT_CONFIG_INVALID', `Project ${projectId} must define repo_path and at least one subject.`);
  }
  const subjects: Record<string, ProjectSubjectDefinition> = {};
  for (const [subjectId, subject] of Object.entries(config.subjects)) {
    if (!isRecord(subject) || !isNonEmptyString(subject.display_name) || !isNonEmptyString(subject.character_file) || !isNonEmptyString(subject.canon_heading)) {
      throw new VisualDirectorError('PROJECT_CONFIG_INVALID', `Subject ${subjectId} in project ${projectId} is incomplete.`);
    }
    subjects[subjectId] = {
      id: subjectId,
      displayName: subject.display_name,
      characterFile: subject.character_file,
      canonHeading: subject.canon_heading,
    };
  }
  return {
    projectId,
    documents: normalizeDocuments(config.documents),
    labels: normalizeLabels(config.labels),
    subjects,
  };
}

function normalizeDocuments(config: Partial<ProjectDocumentsConfig> | undefined): ProjectDocuments {
  if (config !== undefined && !isRecord(config)) {
    throw new VisualDirectorError('PROJECT_CONFIG_INVALID', 'Project documents must be an object.');
  }
  return {
    globalStyle: config?.global_style ?? DEFAULT_PROJECT_DOCUMENTS.globalStyle,
    characterCanon: config?.character_canon ?? DEFAULT_PROJECT_DOCUMENTS.characterCanon,
    worldDirection: config?.world_direction ?? DEFAULT_PROJECT_DOCUMENTS.worldDirection,
    assetManifest: config?.asset_manifest ?? DEFAULT_PROJECT_DOCUMENTS.assetManifest,
    globalReference: config?.global_reference ?? DEFAULT_PROJECT_DOCUMENTS.globalReference,
  };
}

function normalizeLabels(config: Partial<ProjectLabelsConfig> | undefined): ProjectLabels {
  if (config !== undefined && !isRecord(config)) {
    throw new VisualDirectorError('PROJECT_CONFIG_INVALID', 'Project labels must be an object.');
  }
  return {
    avoidBlockHeading: config?.avoid_block_heading ?? DEFAULT_PROJECT_LABELS.avoidBlockHeading,
    allowedChangesHeading: config?.allowed_changes_heading ?? DEFAULT_PROJECT_LABELS.allowedChangesHeading,
    forbiddenChangesHeading: config?.forbidden_changes_heading ?? DEFAULT_PROJECT_LABELS.forbiddenChangesHeading,
    commonRulesHeading: config?.common_rules_heading ?? DEFAULT_PROJECT_LABELS.commonRulesHeading,
    acceptedConditionsHeading: config?.accepted_conditions_heading ?? DEFAULT_PROJECT_LABELS.acceptedConditionsHeading,
  };
}

function resolveConfigPath(configPath: string, configuredPath: string): string {
  return path.resolve(path.dirname(path.resolve(configPath)), configuredPath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
