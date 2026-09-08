import { z } from 'zod';

import { VisualDirectorError } from '../../domain/types.js';
import type { RepositorySource } from '../repository-source.js';
import { DEFAULT_PROJECT_DOCUMENTS, DEFAULT_PROJECT_LABELS } from './types.js';
import type { CanonProjectDefinition, ProjectDocuments, ProjectLabels, ProjectSubjectDefinition } from './types.js';

export const DEFAULT_CANON_MANIFEST_PATH = '.visual-director/manifest.json';
export const SUPPORTED_CANON_MANIFEST_VERSION = 1;

const nonEmptyString = z.string().trim().min(1);
const stringArray = z.array(nonEmptyString).optional().default([]);

const subjectSchema = z.strictObject({
  display_name: nonEmptyString,
  character_file: nonEmptyString,
  canon_heading: nonEmptyString,
  aliases: stringArray,
  anchor_requirements_file: nonEmptyString.optional(),
  required_new_anchor_terms: stringArray,
  anchor_generation_status: z.enum(['active', 'replacement_pending']).optional(),
});

const manifestShapeSchema = z.strictObject({
  version: z.unknown().optional(),
  project_id: z.unknown().optional(),
  documents: z.record(z.string(), z.unknown()).optional(),
  labels: z.record(z.string(), z.unknown()).optional(),
  subjects: z.record(z.string(), z.unknown()).optional(),
});

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
  const shape = manifestShapeSchema.safeParse(input);
  if (!shape.success) throw invalid(path, 'Manifest must be an object with only supported top-level keys.');
  const manifest = shape.data;
  if (manifest.version !== SUPPORTED_CANON_MANIFEST_VERSION) {
    throw new VisualDirectorError('PROJECT_MANIFEST_VERSION_UNSUPPORTED', `Unsupported Visual Director manifest version: ${String(manifest.version)}.`, {
      path,
      supported_version: SUPPORTED_CANON_MANIFEST_VERSION,
    });
  }
  const projectId = parseRequiredString(manifest.project_id, path, 'project_id', 'project_id is required.');

  return {
    projectId,
    documents: parseDocuments(manifest.documents, path),
    labels: parseLabels(manifest.labels, path),
    subjects: parseSubjects(manifest.subjects, path),
  };
}

function parseDocuments(value: Record<string, unknown> | undefined, path: string): ProjectDocuments {
  if (value === undefined) return { ...DEFAULT_PROJECT_DOCUMENTS };
  const allowedKeys = new Set([...Object.keys(DEFAULT_PROJECT_DOCUMENTS), 'grandDesign', 'currentDesignBaseline']);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw invalid(path, `Unknown documents key: ${key}.`);
  }
  const overrides = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, parseRequiredString(item, path, `documents.${key}`)]),
  );
  return { ...DEFAULT_PROJECT_DOCUMENTS, ...overrides };
}

function parseLabels(value: Record<string, unknown> | undefined, path: string): ProjectLabels {
  if (value === undefined) return { ...DEFAULT_PROJECT_LABELS };
  const overrides = Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (!(key in DEFAULT_PROJECT_LABELS)) throw invalid(path, `Unknown labels key: ${key}.`);
      return [key, parseRequiredString(item, path, `labels.${key}`)];
    }),
  );
  return { ...DEFAULT_PROJECT_LABELS, ...overrides };
}

function parseSubjects(value: Record<string, unknown> | undefined, path: string): Record<string, ProjectSubjectDefinition> {
  if (value === undefined) return {};
  const result: Record<string, ProjectSubjectDefinition> = {};
  const aliases = new Map<string, string>();
  for (const [id, subject] of Object.entries(value)) {
    const parsed = subjectSchema.safeParse(subject);
    if (!parsed.success) throw invalid(path, subjectIssueMessage(id, parsed.error));
    const { display_name: displayName, character_file: characterFile, canon_heading: canonHeading } = parsed.data;
    const subjectAliases = [...new Set(parsed.data.aliases)];
    const requiredNewAnchorTerms = [...new Set(parsed.data.required_new_anchor_terms)];
    for (const alias of [id, displayName, ...subjectAliases]) {
      const key = normalizeAlias(alias);
      const existing = aliases.get(key);
      if (existing && existing !== id) {
        throw invalid(path, `Subject alias ${alias} is ambiguous between ${existing} and ${id}.`);
      }
      aliases.set(key, id);
    }
    result[id] = {
      id,
      displayName,
      characterFile,
      canonHeading,
      ...(subjectAliases.length > 0 ? { aliases: subjectAliases } : {}),
      ...(parsed.data.anchor_requirements_file ? { anchorRequirementsFile: parsed.data.anchor_requirements_file } : {}),
      ...(requiredNewAnchorTerms.length > 0 ? { requiredNewAnchorTerms } : {}),
      ...(parsed.data.anchor_generation_status ? { anchorGenerationStatus: parsed.data.anchor_generation_status } : {}),
    };
  }
  return result;
}

function subjectIssueMessage(id: string, error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return `subjects.${id} is invalid.`;
  if (issue.code === 'unrecognized_keys') return `Unknown subjects.${id} key: ${issue.keys[0]}.`;
  const field = issue.path.length > 0 ? `subjects.${id}.${issue.path.join('.')}` : `subjects.${id}`;
  if (field.endsWith('.anchor_generation_status')) return `${field} must be active or replacement_pending.`;
  return `${field} must be ${issue.code === 'invalid_type' && issue.expected === 'array' ? 'an array' : 'a non-empty string'}.`;
}

function parseRequiredString(value: unknown, path: string, field: string, message?: string): string {
  const parsed = nonEmptyString.safeParse(value);
  if (!parsed.success) throw invalid(path, message ?? `${field} must be a non-empty string.`);
  return parsed.data;
}

function normalizeAlias(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/g, '');
}

function invalid(path: string, message: string): VisualDirectorError {
  return new VisualDirectorError('PROJECT_MANIFEST_INVALID', message, { path });
}
