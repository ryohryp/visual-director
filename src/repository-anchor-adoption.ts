import path from 'node:path';

import { compileRepositoryCanon, COMPILED_CANON_RELATIVE_PATH } from './compiled-canon.js';
import { createVisualDirectorCore } from './core/visual-director.js';
import type { AdoptAnchorResult } from './domain/types.js';

export interface AdoptRepositoryAnchorInput {
  projectId: string;
  repositoryPath: string;
  subjectId: string;
  candidatePath: string;
  projectsConfigPath?: string;
}

export interface AdoptRepositoryAnchorResult extends AdoptAnchorResult {
  compiled_canon_path: string;
}

interface AdoptionDependencies {
  createCore?: typeof createVisualDirectorCore;
  compileCanon?: typeof compileRepositoryCanon;
}

export async function adoptRepositoryAnchor(
  input: AdoptRepositoryAnchorInput,
  dependencies: AdoptionDependencies = {},
): Promise<AdoptRepositoryAnchorResult> {
  const repositoryPath = path.resolve(input.repositoryPath);
  const core = (dependencies.createCore ?? createVisualDirectorCore)({
    ...(input.projectsConfigPath ? { projectsConfigPath: input.projectsConfigPath } : {}),
  });

  await core.configureProject(input.projectId, repositoryPath);
  const adopted = await core.adoptAnchor({
    project_id: input.projectId,
    subject_id: input.subjectId,
    candidate_path: input.candidatePath,
    approval: 'approve',
  });

  await (dependencies.compileCanon ?? compileRepositoryCanon)({
    projectId: input.projectId,
    repositoryPath,
  });

  return {
    ...adopted,
    compiled_canon_path: COMPILED_CANON_RELATIVE_PATH,
  };
}
