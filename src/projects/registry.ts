import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { VisualDirectorError } from '../domain/types.js';
import type { OpenAIFileReference, ProjectAdapter } from '../domain/types.js';
import { inspectImage, MAX_IMAGE_BYTES } from '../domain/image.js';
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
  fetchImpl?: typeof fetch;
  writeAnchorFile?: (filePath: string, bytes: Uint8Array) => Promise<void>;
  replaceCanonFile?: (filePath: string, contents: string, errorCode: string) => Promise<void>;
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
  const fetchImpl = options.fetchImpl ?? fetch;
  const writeAnchorFile = options.writeAnchorFile ?? (async (filePath: string, bytes: Uint8Array) => {
    await writeFile(filePath, bytes, { flag: 'wx' });
  });
  const replaceCanonFile = options.replaceCanonFile ?? replaceFileAtomically;
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
      if (input.approval !== 'approve') {
        throw new VisualDirectorError('APPROVAL_REQUIRED', 'approval must be exactly "approve".');
      }
      const repoPath = repoPaths.get(input.project_id) ?? process.env.BOTTOM_OF_THIRST_REPO_PATH;
      if (!repoPath) {
        throw new VisualDirectorError('PROJECT_CONFIG_MISSING', `No repository path is configured for project_id: ${input.project_id}.`);
      }
      const repository = await resolveRepository(repoPath, input.project_id);
      const subject = input.project_id === bottomOfThirstDefinition.projectId
        ? bottomOfThirstCanonSubject(input.subject_id)
        : definition.subjects[input.subject_id.trim()];
      if (!subject) {
        throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${input.subject_id}.`);
      }
      const hasCandidateFile = input.candidate_file !== undefined;
      const hasCandidatePath = input.candidate_path !== undefined;
      if (hasCandidateFile === hasCandidatePath) {
        throw new VisualDirectorError(
          'AMBIGUOUS_CANDIDATE_INPUT',
          'Provide exactly one of candidate_file or candidate_path.',
        );
      }

      const canonPath = safeRepositoryRelativePath(definition.documents.characterCanon, 'character_canon');
      const canonAbsolutePath = path.resolve(repository.absolutePath, canonPath);
      await ensureExistingRepositoryFile(repository, canonAbsolutePath, 'CANON_READ_FAILED', canonPath);
      let canonMarkdown: string;
      try {
        canonMarkdown = await readFile(canonAbsolutePath, 'utf8');
      } catch (error) {
        throw new VisualDirectorError('CANON_READ_FAILED', 'Could not read the character Visual Canon.', {
          path: canonPath,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      if (!hasCanonSubject(canonMarkdown, subject.canonHeading)) {
        throw new VisualDirectorError('CANON_SUBJECT_NOT_FOUND', 'The subject section is missing from the character Visual Canon.', {
          canon_heading: subject.canonHeading,
        });
      }

      const existingAnchorPath = findApprovedAnchor(canonMarkdown, subject.canonHeading);
      if (existingAnchorPath) safeRepositoryRelativePath(existingAnchorPath, 'existing_approved_anchor_path');

      if (hasCandidatePath) {
        const candidatePath = safeRepositoryRelativePath(input.candidate_path as string, 'candidate_path');
        const candidateAbsolutePath = path.resolve(repository.absolutePath, candidatePath);
        await ensureExistingRepositoryFile(repository, candidateAbsolutePath, 'ANCHOR_CANDIDATE_NOT_FOUND', candidatePath);
        const candidateBytes = await readFile(candidateAbsolutePath);
        const image = inspectImage(candidateBytes, { fileName: candidatePath, requireFileNameExtension: true });
        if (existingAnchorPath && existingAnchorPath !== candidatePath) {
          throw new VisualDirectorError('APPROVED_ANCHOR_CONFLICT', 'An Approved Visual Anchor is already registered for this subject.', {
            existing_path: existingAnchorPath,
            candidate_path: candidatePath,
          });
        }
        if (existingAnchorPath === candidatePath) {
          return buildAdoptAnchorResult(input.project_id, subject.id, candidatePath, canonPath, false, candidateBytes, image);
        }
        const updated = registerApprovedAnchor(canonMarkdown, subject.canonHeading, candidatePath);
        await replaceCanonFile(canonAbsolutePath, updated, 'CANON_WRITE_FAILED');
        return buildAdoptAnchorResult(input.project_id, subject.id, candidatePath, canonPath, true, candidateBytes, image);
      }

      if (existingAnchorPath) {
        throw new VisualDirectorError('APPROVED_ANCHOR_CONFLICT', 'An Approved Visual Anchor is already registered for this subject.', {
          existing_path: existingAnchorPath,
        });
      }
      const downloaded = await downloadCandidateFile(input.candidate_file as OpenAIFileReference, fetchImpl);
      const anchorPath = anchorDestinationPath(subject.id, downloaded.image.extension);
      const anchorAbsolutePath = path.resolve(repository.absolutePath, anchorPath);
      const createdDirectories = await ensureSafeDestination(repository, anchorAbsolutePath, anchorPath);
      let committed = false;
      let temporaryPath = '';
      try {
        temporaryPath = `${anchorAbsolutePath}.${randomUUID()}.tmp`;
        await writeAnchorFile(temporaryPath, downloaded.bytes);
        try {
          await rename(temporaryPath, anchorAbsolutePath);
        } catch (error) {
          await rm(temporaryPath, { force: true });
          throw error;
        }
        committed = true;
        const updated = registerApprovedAnchor(canonMarkdown, subject.canonHeading, anchorPath);
        await replaceCanonFile(canonAbsolutePath, updated, 'CANON_WRITE_FAILED');
      } catch (error) {
        if (temporaryPath) await rm(temporaryPath, { force: true });
        if (committed) await rm(anchorAbsolutePath, { force: true });
        await removeEmptyDirectories(createdDirectories);
        throw error instanceof VisualDirectorError
          ? error
          : new VisualDirectorError('ANCHOR_ADOPTION_FAILED', 'The image and Canon could not be committed atomically.', {
            reason: error instanceof Error ? error.message : String(error),
          });
      }
      return buildAdoptAnchorResult(
        input.project_id,
        subject.id,
        anchorPath,
        canonPath,
        true,
        downloaded.bytes,
        downloaded.image,
      );
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

interface RepositoryRoot {
  absolutePath: string;
  realPath: string;
}

interface DownloadedCandidate {
  bytes: Buffer;
  image: ReturnType<typeof inspectImage>;
}

async function resolveRepository(repositoryPath: string, projectId: string): Promise<RepositoryRoot> {
  const absolutePath = path.resolve(repositoryPath);
  try {
    const repositoryStats = await stat(absolutePath);
    if (!repositoryStats.isDirectory()) throw new Error('Path is not a directory.');
    return { absolutePath, realPath: await realpath(absolutePath) };
  } catch (error) {
    throw new VisualDirectorError('PROJECT_REPOSITORY_INVALID', 'The configured repository path cannot be used.', {
      project_id: projectId,
      repository_path: absolutePath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function isWithinOrEqual(parent: string, candidate: string): boolean {
  return parent === candidate || isWithin(parent, candidate);
}

async function ensureExistingRepositoryFile(
  repository: RepositoryRoot,
  absolutePath: string,
  code: string,
  relativePath: string,
): Promise<void> {
  if (!isWithinOrEqual(repository.absolutePath, absolutePath)) {
    throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'A repository path resolves outside the configured repository.', {
      path: relativePath,
    });
  }
  try {
    const fileStats = await lstat(absolutePath);
    if (fileStats.isSymbolicLink()) {
      throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'Symlinked repository files are not accepted.', {
        path: relativePath,
      });
    }
    if (!fileStats.isFile()) throw new Error('Path is not a regular file.');
    const realFilePath = await realpath(absolutePath);
    if (!isWithin(repository.realPath, realFilePath)) {
      throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'A repository file resolves outside the configured repository.', {
        path: relativePath,
      });
    }
  } catch (error) {
    if (error instanceof VisualDirectorError) throw error;
    throw new VisualDirectorError(code, 'The approved Anchor candidate must be an existing repository file.', {
      path: relativePath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function ensureSafeDestination(
  repository: RepositoryRoot,
  absolutePath: string,
  relativePath: string,
): Promise<string[]> {
  if (!isWithin(repository.absolutePath, absolutePath)) {
    throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'The Anchor destination resolves outside the configured repository.', {
      path: relativePath,
    });
  }
  const missingDirectories: string[] = [];
  let current = path.dirname(absolutePath);
  while (current !== repository.absolutePath) {
    let exists = true;
    try {
      const currentStats = await lstat(current);
      if (currentStats.isSymbolicLink()) throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'Symlinked destination directories are not accepted.', { path: relativePath });
      if (!currentStats.isDirectory()) throw new Error('Destination parent is not a directory.');
    } catch (error) {
      if (error instanceof VisualDirectorError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new VisualDirectorError('ANCHOR_DESTINATION_INVALID', 'The Anchor destination directory cannot be used.', { path: relativePath });
      exists = false;
    }
    if (!exists) missingDirectories.push(current);
    current = path.dirname(current);
    if (!isWithinOrEqual(repository.absolutePath, current)) {
      throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'The Anchor destination escapes the configured repository.', {
        path: relativePath,
      });
    }
  }
  const existingParentRealPath = await realpath(current);
  if (!isWithinOrEqual(repository.realPath, existingParentRealPath)) {
    throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'The Anchor destination resolves outside the configured repository.', {
      path: relativePath,
    });
  }
  const createdDirectories: string[] = [];
  for (const directory of [...missingDirectories].reverse()) {
    await mkdir(directory);
    const directoryStats = await lstat(directory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'The Anchor destination directory is unsafe.', { path: relativePath });
    }
    createdDirectories.push(directory);
  }
  try {
    const destinationStats = await lstat(absolutePath);
    if (destinationStats.isSymbolicLink()) throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'The Anchor destination is a symlink.', { path: relativePath });
    throw new VisualDirectorError('ANCHOR_DESTINATION_CONFLICT', 'The canonical Anchor destination already exists.', { path: relativePath });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return createdDirectories;
    await removeEmptyDirectories(createdDirectories);
    if (error instanceof VisualDirectorError) throw error;
    throw new VisualDirectorError('ANCHOR_DESTINATION_INVALID', 'The Anchor destination cannot be used.', {
      path: relativePath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function removeEmptyDirectories(directories: string[]): Promise<void> {
  for (const directory of [...directories].reverse()) {
    try {
      await rm(directory, { recursive: false, force: true });
    } catch {
      // Best-effort cleanup; the committed image and Canon remain the authoritative transaction state.
    }
  }
}

async function replaceFileAtomically(filePath: string, contents: string, errorCode: string): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const backupPath = `${filePath}.${randomUUID()}.bak`;
  let backupCreated = false;
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(filePath, backupPath);
    backupCreated = true;
    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      await rename(backupPath, filePath).catch(() => undefined);
      throw error;
    }
    try {
      await rm(backupPath, { force: true });
    } catch (error) {
      await rm(filePath, { force: true });
      await rename(backupPath, filePath).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (backupCreated) {
      try {
        await lstat(backupPath);
        if (!(await pathExists(filePath))) await rename(backupPath, filePath);
      } catch {
        // The inner rollback already attempted to restore the original file.
      }
    }
    if (error instanceof VisualDirectorError) throw error;
    throw new VisualDirectorError(errorCode, 'The Canon could not be updated atomically.', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function downloadCandidateFile(file: OpenAIFileReference, fetchImpl: typeof fetch): Promise<DownloadedCandidate> {
  if (!file || typeof file !== 'object' || typeof file.download_url !== 'string' || !file.download_url.trim()
    || typeof file.file_id !== 'string' || !file.file_id.trim()) {
    throw new VisualDirectorError('INVALID_FILE_REFERENCE', 'candidate_file must include download_url and file_id.');
  }
  if (file.file_name && /[\\/]/.test(file.file_name)) {
    throw new VisualDirectorError('UNSAFE_FILE_REFERENCE', 'candidate_file.file_name must be a file name, not a path.');
  }
  let downloadUrl: URL;
  try {
    downloadUrl = new URL(file.download_url);
  } catch {
    throw new VisualDirectorError('FILE_DOWNLOAD_URL_INVALID', 'candidate_file.download_url must be a valid HTTPS URL.');
  }
  if (downloadUrl.protocol !== 'https:' || downloadUrl.username || downloadUrl.password) {
    throw new VisualDirectorError('FILE_DOWNLOAD_URL_INVALID', 'candidate_file.download_url must be a credential-free HTTPS URL.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetchImpl(downloadUrl.toString(), { redirect: 'manual', signal: controller.signal });
  } catch (error) {
    clearTimeout(timeout);
    throw new VisualDirectorError('FILE_DOWNLOAD_FAILED', 'The candidate file could not be downloaded.', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    if (response.status >= 300 && response.status < 400) {
      throw new VisualDirectorError('FILE_DOWNLOAD_FAILED', 'Redirects are not accepted for candidate files.');
    }
    if (!response.ok) {
      throw new VisualDirectorError('FILE_DOWNLOAD_FAILED', 'The candidate file download returned an error.', {
        status: response.status,
      });
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new VisualDirectorError('IMAGE_TOO_LARGE', 'The downloaded candidate file exceeds the 25 MiB limit.', {
        max_bytes: MAX_IMAGE_BYTES,
      });
    }
    const bytes = await readResponseBody(response);
    const image = inspectImage(bytes, {
      declaredMimeType: file.mime_type ?? response.headers.get('content-type') ?? undefined,
      fileName: file.file_name,
    });
    return { bytes: Buffer.from(bytes), image };
  } catch (error) {
    if (error instanceof VisualDirectorError) throw error;
    throw new VisualDirectorError('FILE_DOWNLOAD_FAILED', 'The candidate file could not be read from the download response.', {
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseBody(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw new VisualDirectorError('IMAGE_TOO_LARGE', 'The downloaded candidate file exceeds the 25 MiB limit.', {
            max_bytes: MAX_IMAGE_BYTES,
          });
        }
        chunks.push(Buffer.from(value));
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

function anchorDestinationPath(subjectId: string, extension: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(subjectId)) {
    throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'The subject_id cannot be used to derive an Anchor destination.', {
      subject_id: subjectId,
    });
  }
  return `public/images/characters/${subjectId}/v2/default.${extension}`;
}

function hasCanonSubject(markdown: string, canonHeading: string): boolean {
  return new RegExp(`^##\\s+${escapeRegExp(canonHeading)}[ \\t]*$`, 'm').test(markdown);
}

function findApprovedAnchor(markdown: string, canonHeading: string): string | undefined {
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(canonHeading)}[ \\t]*$`, 'm');
  const headingMatch = headingPattern.exec(markdown);
  if (!headingMatch || headingMatch.index === undefined) return undefined;
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const rest = markdown.slice(sectionStart);
  const nextHeadingOffset = rest.search(/^##\s+/m);
  const sectionEnd = nextHeadingOffset >= 0 ? sectionStart + nextHeadingOffset : markdown.length;
  const section = markdown.slice(sectionStart, sectionEnd);
  const approvedHeading = /^###\s+Approved Visual Anchor[ \t]*$/m.exec(section);
  if (approvedHeading?.index === undefined) return undefined;
  const afterHeading = approvedHeading.index + approvedHeading[0].length;
  const approvedRest = section.slice(afterHeading);
  const nextSubheading = approvedRest.search(/^###\s+/m);
  const approvedEnd = nextSubheading >= 0 ? afterHeading + nextSubheading : section.length;
  return section.slice(afterHeading, approvedEnd).match(/^\s*-\s+`([^`]+)`\s*$/m)?.[1];
}

function buildAdoptAnchorResult(
  projectId: string,
  subjectId: string,
  anchorPath: string,
  canonPath: string,
  changed: boolean,
  bytes: Uint8Array,
  image: ReturnType<typeof inspectImage>,
): AdoptAnchorResult {
  return {
    project_id: projectId,
    subject_id: subjectId,
    status: 'approved',
    anchor_path: anchorPath,
    approved_anchor_path: anchorPath,
    canon_path: canonPath,
    changed,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mime_type: image.mime_type,
    width: image.width,
    height: image.height,
  };
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
