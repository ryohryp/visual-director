import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { VisualDirectorError } from '../domain/types.js';
import { LocalRepositorySource } from './repository-source.js';

export interface ProjectRegistryEntry {
  project_id: string;
  repository: string;
}

export interface ProjectRegistry {
  list(): readonly ProjectRegistryEntry[];
  resolve(projectId: string): ProjectRegistryEntry;
}

interface RawRegistry {
  projects?: unknown;
}

export const DEFAULT_PROJECT_REGISTRY_PATH = path.join(os.homedir(), '.visual-director', 'projects.json');

export function resolveProjectRegistryPath(explicitPath?: string): string {
  return explicitPath?.trim()
    || process.env.VISUAL_DIRECTOR_PROJECT_REGISTRY?.trim()
    || DEFAULT_PROJECT_REGISTRY_PATH;
}

export function loadProjectRegistry(filePath = resolveProjectRegistryPath()): ProjectRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new VisualDirectorError('PROJECT_REGISTRY_UNAVAILABLE', 'Project Registry could not be read.', {
      path: filePath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return parseProjectRegistry(parsed);
}

export function parseProjectRegistry(input: unknown): ProjectRegistry {
  if (!isRecord(input) || !isRecord((input as RawRegistry).projects)) {
    throw new VisualDirectorError('PROJECT_REGISTRY_INVALID', 'Project Registry must contain a projects object.');
  }

  const entries = Object.entries((input as { projects: Record<string, unknown> }).projects).map(([projectId, value]) => {
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(projectId)) {
      throw new VisualDirectorError('PROJECT_REGISTRY_INVALID', `Invalid project_id: ${projectId}.`, { project_id: projectId });
    }
    if (!isRecord(value) || typeof value.repository !== 'string' || !value.repository.trim()) {
      throw new VisualDirectorError('PROJECT_REGISTRY_INVALID', `Project Registry entry ${projectId} requires repository.`, {
        project_id: projectId,
      });
    }
    return { project_id: projectId, repository: path.resolve(expandHome(value.repository.trim())) };
  });

  const byId = new Map(entries.map((entry) => [entry.project_id, entry]));
  return {
    list: () => entries.map((entry) => ({ ...entry })),
    resolve(projectId: string): ProjectRegistryEntry {
      const normalized = projectId.trim();
      if (!normalized) throw new VisualDirectorError('INVALID_INPUT', 'project_id is required.');
      const entry = byId.get(normalized);
      if (!entry) {
        throw new VisualDirectorError('PROJECT_NOT_FOUND', `Unknown project_id: ${projectId}.`, {
          known_project_ids: [...byId.keys()],
        });
      }
      return { ...entry };
    },
  };
}

export function createRegisteredLocalRepositorySource(
  projectId: string,
  registry: ProjectRegistry = loadProjectRegistry(),
): LocalRepositorySource {
  return new LocalRepositorySource(registry.resolve(projectId).repository);
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
