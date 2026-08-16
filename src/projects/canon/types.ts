import type { RepositorySource } from '../repository-source.js';

export interface ProjectDocuments {
  globalStyle: string;
  characterCanon: string;
  worldDirection: string;
  assetManifest: string;
  globalReference: string;
}

export interface ProjectSubjectDefinition {
  id: string;
  displayName: string;
  characterFile: string;
  canonHeading: string;
  aliases: string[];
}

export interface ProjectLabels {
  avoidBlockHeading: string;
  allowedChangesHeading: string;
  forbiddenChangesHeading: string;
  commonRulesHeading: string;
  acceptedConditionsHeading: string;
}

export interface CanonProjectDefinition {
  projectId: string;
  documents: ProjectDocuments;
  subjects: Record<string, ProjectSubjectDefinition>;
  labels: ProjectLabels;
}

export interface CanonProjectAdapterOptions {
  repoPath?: string;
  source?: RepositorySource;
}

export const DEFAULT_PROJECT_DOCUMENTS: ProjectDocuments = {
  globalStyle: 'docs/visual/GLOBAL_VISUAL_STYLE.md',
  characterCanon: 'docs/visual/CHARACTER_VISUAL_CANON.md',
  worldDirection: 'docs/WORLD_DIRECTION.md',
  assetManifest: 'docs/visual/assets/README.md',
  globalReference: 'docs/visual/assets/global_visual_style_reference.webp',
};

export const DEFAULT_PROJECT_LABELS: ProjectLabels = {
  avoidBlockHeading: 'Fixed Avoid Block',
  allowedChangesHeading: 'Allowed Changes',
  forbiddenChangesHeading: 'Forbidden Changes',
  commonRulesHeading: 'Common Rules',
  acceptedConditionsHeading: 'Accepted Visual Conditions',
};
