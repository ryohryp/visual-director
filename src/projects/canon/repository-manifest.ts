import { VisualDirectorError } from '../../domain/types.js';
import type { RepositorySource } from '../repository-source.js';
import { DEFAULT_PROJECT_DOCUMENTS, DEFAULT_PROJECT_LABELS } from './types.js';
import type { CanonProjectDefinition, ProjectDocuments, ProjectLabels, ProjectSubjectDefinition } from './types.js';

export const DEFAULT_CANON_MANIFEST_PATH = '.visual-director/manifest.json';
export const SUPPORTED_CANON_MANIFEST_VERSION = 1;

interface RawManifest {
  version?: unknown;
  project_id?: unknown;
  documents?: unknown;
  labels?: unknown;
  subjects?: unknown;
}

export async function loadRepositoryCanonDefinition(
  source: RepositorySource,
  manifestPath = DEFAULT_CANON_MANIFEST_PATH,
): Promise<CanonProjectDefinition> {
  const raw = await source.readText(manifestPath, 'Visual Director project manifest');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new VisualDirectorError('PROJECT_MANIFEST_INVALID', 'Visual Director project manifest is not valid JSON.', {
      path: manifestPath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return parseRepositoryCanonManifest(parsed, manifestPath);
}

export function parseRepositoryCanonManifest(input: unknown, path = DEFAULT_CANON_MANIFEST_PATH): CanonProjectDefinition {
  if (!isRecord(input)) throw invalid(path, 'Manifest must be an object.');
  const manifest = input as RawManifest;
  if (manifest.version !== SUPPORTED_CANON_MANIFEST_VERSION) {
    throw new VisualDirectorError('PROJECT_MANIFEST_VERSION_UNSUPPORTED', `Unsupported Visual Director manifest version: ${String(manifest.version)}.`, {
      path,
      supported_version: SUPPORTED_CANON_MANIFEST_VERSION,
    });
  }
  if (typeof manifest.project_id !== 'string' || !manifest.project_id.trim()) throw invalid(path, 'project_id is required.');

  return {
    projectId: manifest.project_id.trim(),
    documents: mergeStringRecord(DEFAULT_PROJECT_DOCUMENTS, manifest.documents, path, 'documents'),
    labels: mergeStringRecord(DEFAULT_PROJECT_LABELS, manifest.labels, path, 'labels'),
    subjects: parseSubjects(manifest.subjects, path),
  };
}

function parseSubjects(value: unknown, path: string): Record<string, ProjectSubjectDefinition> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw invalid(path, 'subjects must be an object.');
  const result: Record<string, ProjectSubjectDefinition> = {};
  for (const [id, subject] of Object.entries(value)) {
    if (!isRecord(subject)) throw invalid(path, `subjects.${id} must be an object.`);
    const displayName = requiredString(subject.display_name, path, `subjects.${id}.display_name`);
    const characterFile = requiredString(subject.character_file, path, `subjects.${id}.character_file`);
    const canonHeading = requiredString(subject.canon_heading, path, `subjects.${id}.canon_heading`);
    result[id] = { id, displayName, characterFile, canonHeading };
  }
  return result;
}

function mergeStringRecord<T extends ProjectDocuments | ProjectLabels>(defaults: T, value: unknown, path: string, field: string): T {
  if (value === undefined) return { ...defaults };
  if (!isRecord(value)) throw invalid(path, `${field} must be an object.`);
  const result = { ...defaults } as Record<string, string>;
  for (const [key, item] of Object.entries(value)) {
    if (!(key in defaults)) throw invalid(path, `Unknown ${field} key: ${key}.`);
    result[key] = requiredString(item, path, `${field}.${key}`);
  }
  return result as T;
}

function requiredString(value: unknown, path: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(path, `${field} must be a non-empty string.`);
  return value.trim();
}

function invalid(path: string, message: string): VisualDirectorError {
  return new VisualDirectorError('PROJECT_MANIFEST_INVALID', message, { path });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
