import { COMPILED_CANON_RELATIVE_PATH, compileCanonFromSource, serializeCompiledCanon } from '../compiled-canon.js';
import { VisualDirectorError } from '../domain/types.js';
import type { AdoptAnchorInput, AdoptAnchorResult } from '../domain/types.js';
import { createCatalogRepositorySource, resolveCatalogEntry } from '../projects/catalog-runtime.js';
import { loadRepositoryCanonDefinition } from '../projects/canon/repository-manifest.js';
import { GitHubRepositoryWriter } from '../projects/github-repository-writer.js';
import type { RepositoryCommitResult, RepositoryTextWrite } from '../projects/github-repository-writer.js';
import { registerApprovedAnchor } from '../projects/runtime-registry.js';
import type { RepositorySource } from '../projects/repository-source.js';
import { bindApprovedEditSource } from './approved-edit-source.js';

interface HostedAnchorAdoptionDependencies {
  source?: RepositorySource;
  fetchImpl?: typeof fetch;
  writeToken?: string;
  writer?: {
    commitTextFiles(files: readonly RepositoryTextWrite[], message: string): Promise<RepositoryCommitResult>;
  };
}

interface ApprovedAnchorManifest {
  project_id: string;
  subject_id: string;
  source: {
    path: string;
    dimensions: [number, number];
    sha256: string;
    mime_type: string;
  };
}

export async function adoptHostedApprovedAnchor(
  input: AdoptAnchorInput,
  dependencies: HostedAnchorAdoptionDependencies = {},
): Promise<AdoptAnchorResult> {
  if (input.approval !== 'approve') {
    throw new VisualDirectorError('APPROVAL_REQUIRED', 'approval must be exactly "approve".');
  }
  if (!input.candidate_file || !input.candidate_path) {
    throw new VisualDirectorError(
      'HOSTED_ANCHOR_ADOPTION_INPUT_REQUIRED',
      'Hosted Anchor adoption requires both the Approved Candidate manifest path and the exact approved source file.',
      { project_id: input.project_id, subject_id: input.subject_id },
    );
  }

  const entry = resolveCatalogEntry(input.project_id);
  const source = dependencies.source ?? createCatalogRepositorySource(entry, { fetchImpl: dependencies.fetchImpl });
  const bound = await bindApprovedEditSource(
    input.project_id,
    input.candidate_path,
    input.candidate_file,
    source,
    dependencies.fetchImpl ?? fetch,
  );
  const manifest = parseApprovedAnchorManifest(
    await source.readText(input.candidate_path, 'Approved Anchor candidate manifest'),
    input.candidate_path,
  );
  validateBindingScope(input, manifest, bound.binding);
  await source.ensureFile(manifest.source.path, 'Approved Anchor source');

  const definition = await loadRepositoryCanonDefinition(source);
  if (definition.projectId !== input.project_id.trim()) {
    throw new VisualDirectorError('PROJECT_MANIFEST_INVALID', 'Project manifest project_id does not match requested project_id.', {
      requested_project_id: input.project_id,
      manifest_project_id: definition.projectId,
    });
  }
  const subject = Object.values(definition.subjects).find((candidate) => candidate.id === manifest.subject_id);
  if (!subject) {
    throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${input.subject_id}.`, {
      project_id: input.project_id,
    });
  }

  const canonPath = definition.documents.characterCanon;
  const canonMarkdown = await source.readText(canonPath, 'Character Visual Canon');
  const updatedCanon = registerApprovedAnchor(canonMarkdown, subject.canonHeading, manifest.source.path);
  const result: AdoptAnchorResult = {
    project_id: input.project_id.trim(),
    subject_id: subject.id,
    status: 'approved',
    anchor_path: manifest.source.path,
    approved_anchor_path: manifest.source.path,
    canon_path: canonPath,
    changed: updatedCanon !== canonMarkdown,
    sha256: bound.binding.sha256,
    mime_type: bound.binding.mime_type,
    width: bound.binding.width,
    height: bound.binding.height,
  };

  if (!result.changed) return result;

  const writeToken = dependencies.writeToken ?? process.env.VISUAL_DIRECTOR_GITHUB_WRITE_TOKEN?.trim();
  if (!writeToken && !dependencies.writer) {
    throw new VisualDirectorError(
      'HOSTED_ANCHOR_WRITE_UNAVAILABLE',
      'The Approved Anchor was validated, but hosted repository adoption is not configured for writes.',
      {
        project_id: input.project_id,
        subject_id: subject.id,
        repository: `${entry.repository.owner}/${entry.repository.name}`,
        ref: entry.ref,
      },
    );
  }

  const overlaySource = new TextOverlayRepositorySource(source, new Map([[canonPath, updatedCanon]]));
  const compiledCanon = await compileCanonFromSource(input.project_id.trim(), overlaySource);
  const writer = dependencies.writer ?? new GitHubRepositoryWriter({
    owner: entry.repository.owner,
    repo: entry.repository.name,
    ref: entry.ref,
    token: writeToken as string,
    fetchImpl: dependencies.fetchImpl,
  });
  await writer.commitTextFiles(
    [
      { path: canonPath, content: updatedCanon },
      { path: COMPILED_CANON_RELATIVE_PATH, content: serializeCompiledCanon(compiledCanon) },
    ],
    `chore(visual): adopt ${subject.id} Approved Anchor`,
  );
  return result;
}

function parseApprovedAnchorManifest(raw: string, manifestPath: string): ApprovedAnchorManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new VisualDirectorError('APPROVED_SOURCE_MANIFEST_INVALID', 'Approved Anchor candidate manifest is not valid JSON.', {
      path: manifestPath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (!isRecord(parsed)
    || parsed.status !== 'approved_candidate'
    || typeof parsed.project_id !== 'string' || !parsed.project_id.trim()
    || typeof parsed.subject_id !== 'string' || !parsed.subject_id.trim()
    || !isRecord(parsed.source)) {
    throw new VisualDirectorError(
      'APPROVED_SOURCE_MANIFEST_INVALID',
      'Approved Anchor candidate manifest requires approved status, project_id, subject_id, and source metadata.',
      { path: manifestPath },
    );
  }
  const source = parsed.source;
  if (typeof source.path !== 'string'
    || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)
    || typeof source.mime_type !== 'string' || !source.mime_type.trim()
    || !Array.isArray(source.dimensions) || source.dimensions.length !== 2
    || !source.dimensions.every((value) => Number.isSafeInteger(value) && Number(value) > 0)) {
    throw new VisualDirectorError(
      'APPROVED_SOURCE_MANIFEST_INVALID',
      'Approved Anchor source metadata requires a safe path, SHA-256, MIME type, and two positive dimensions.',
      { path: manifestPath },
    );
  }
  const anchorPath = safeRepositoryPath(source.path, 'source.path');
  return {
    project_id: parsed.project_id.trim(),
    subject_id: parsed.subject_id.trim(),
    source: {
      path: anchorPath,
      dimensions: [Number(source.dimensions[0]), Number(source.dimensions[1])],
      sha256: source.sha256,
      mime_type: source.mime_type.trim().toLowerCase(),
    },
  };
}

function validateBindingScope(
  input: AdoptAnchorInput,
  manifest: ApprovedAnchorManifest,
  binding: Awaited<ReturnType<typeof bindApprovedEditSource>>['binding'],
): void {
  const projectId = input.project_id.trim();
  const subjectId = input.subject_id.trim();
  if (manifest.project_id !== projectId) {
    throw new VisualDirectorError('APPROVED_ANCHOR_SCOPE_MISMATCH', 'Approved Anchor manifest belongs to a different project.', {
      requested_project_id: projectId,
      manifest_project_id: manifest.project_id,
    });
  }
  if (manifest.subject_id !== subjectId) {
    throw new VisualDirectorError('APPROVED_ANCHOR_SCOPE_MISMATCH', 'Approved Anchor manifest belongs to a different subject.', {
      requested_subject_id: subjectId,
      manifest_subject_id: manifest.subject_id,
    });
  }
  if (manifest.source.sha256 !== binding.sha256
    || manifest.source.dimensions[0] !== binding.width
    || manifest.source.dimensions[1] !== binding.height
    || manifest.source.mime_type !== binding.mime_type.toLowerCase()) {
    throw new VisualDirectorError(
      'APPROVED_SOURCE_MANIFEST_INVALID',
      'Approved Anchor source metadata does not match the verified source bytes.',
      {
        candidate_id: binding.candidate_id,
        source_path: manifest.source.path,
      },
    );
  }
}

class TextOverlayRepositorySource implements RepositorySource {
  readonly kind: RepositorySource['kind'];

  constructor(
    private readonly base: RepositorySource,
    private readonly text: ReadonlyMap<string, string>,
  ) {
    this.kind = base.kind;
  }

  checkAccess(): Promise<void> {
    return this.base.checkAccess();
  }

  readText(relativePath: string, label: string): Promise<string> {
    const overlay = this.text.get(relativePath);
    return overlay === undefined ? this.base.readText(relativePath, label) : Promise.resolve(overlay);
  }

  ensureFile(relativePath: string, label: string): Promise<void> {
    return this.text.has(relativePath) ? Promise.resolve() : this.base.ensureFile(relativePath, label);
  }

  fileExists(relativePath: string): Promise<boolean> {
    return this.text.has(relativePath) ? Promise.resolve(true) : this.base.fileExists(relativePath);
  }
}

function safeRepositoryPath(value: string, field: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', `${field} must be a repository-relative path.`, { [field]: value });
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
