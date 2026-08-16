import { section, subsection } from '../domain/markdown.js';
import { WORKFLOW_INDEX_PATH } from '../domain/visual-overview.js';
import { VisualDirectorError } from '../domain/types.js';
import type { ProjectVisualOverview } from '../domain/types.js';
import {
  approvedAnchorPaths,
  bottomOfThirstCanonSubject,
  configuredSubjects,
} from './bottom-of-thirst/adapter.js';
import type { ProjectCatalogEntry } from './catalog.js';
import type { RepositorySource } from './repository-source.js';
import { DEFAULT_PROJECT_DOCUMENTS } from './canon/types.js';
import type { ProjectDocuments } from './canon/types.js';
import { crownlessDefinition } from './crownless/definition.js';

export type ProjectDiagnosticState =
  | 'ready'
  | 'optional_missing'
  | 'required_missing'
  | 'access_error'
  | 'invalid_reference'
  | 'not_initialized';

export interface ProjectDiagnosticItem {
  key: string;
  label: string;
  state: ProjectDiagnosticState;
  blocking: boolean;
  message: string;
  path?: string;
}

export interface ProjectDiagnostics {
  project_id: string;
  state: 'ready' | 'required_missing' | 'access_error' | 'invalid_reference';
  usable: boolean;
  items: ProjectDiagnosticItem[];
}

export async function diagnoseProjectRepository(
  entry: ProjectCatalogEntry,
  source: RepositorySource,
  loadOverview: () => Promise<ProjectVisualOverview>,
): Promise<ProjectDiagnostics> {
  const items: ProjectDiagnosticItem[] = [];

  try {
    await source.checkAccess();
    items.push({
      key: 'repository_access',
      label: 'Repository access',
      state: 'ready',
      blocking: false,
      message: 'Repository is accessible.',
    });

    const documents = diagnosticDocuments(entry);
    const requiredFiles = [
      ['global_style', 'Global Visual Style', documents.globalStyle],
      ['character_canon', 'Character Visual Canon', documents.characterCanon],
      ['world_direction', 'World Direction', documents.worldDirection],
      ['asset_manifest', 'Visual asset manifest', documents.assetManifest],
      ['global_reference', 'Global Visual Style reference', documents.globalReference],
    ] as const;

    for (const [key, label, path] of requiredFiles) {
      const exists = await source.fileExists(path);
      items.push(exists
        ? { key, label, state: 'ready', blocking: false, message: `${label} found.`, path }
        : { key, label, state: 'required_missing', blocking: true, message: `${label} is required but missing.`, path });
    }

    if (items.some((item) => item.blocking)) return finalize(entry.project_id, items);

    if (entry.adapter_type === 'bottom-of-thirst') {
      await diagnoseBottomOfThirstAnchors(source, items);
    } else {
      await diagnoseOverviewReferences(loadOverview, items);
    }

    if (!items.some((item) => item.key === 'approved_anchors')) {
      await diagnoseOverviewReferences(loadOverview, items);
    }

    const overview = await safeOverview(loadOverview);
    items.push(overview?.visual_direction.grand_design
      ? {
          key: 'grand_design',
          label: 'Grand Design',
          state: 'ready',
          blocking: false,
          message: 'Grand Design configured.',
          ...(overview.visual_direction.grand_design.asset_path
            ? { path: overview.visual_direction.grand_design.asset_path }
            : {}),
        }
      : {
          key: 'grand_design',
          label: 'Grand Design',
          state: 'optional_missing',
          blocking: false,
          message: 'Grand Design is not configured. This is optional.',
        });

    const workflowExists = await source.fileExists(WORKFLOW_INDEX_PATH);
    items.push(workflowExists
      ? {
          key: 'workflow_index',
          label: 'Workflow index',
          state: 'ready',
          blocking: false,
          message: 'Workflow index initialized.',
          path: WORKFLOW_INDEX_PATH,
        }
      : {
          key: 'workflow_index',
          label: 'Workflow index',
          state: 'not_initialized',
          blocking: false,
          message: 'Workflow is not initialized yet.',
          path: WORKFLOW_INDEX_PATH,
        });
  } catch (error) {
    if (error instanceof VisualDirectorError && (error.code === 'GITHUB_REPOSITORY_UNAVAILABLE' || error.code === 'REPOSITORY_UNAVAILABLE')) {
      items.push({
        key: 'repository_access',
        label: 'Repository access',
        state: 'access_error',
        blocking: true,
        message: error.message,
      });
      return finalize(entry.project_id, items);
    }
    if (error instanceof VisualDirectorError && (error.code === 'REFERENCE_NOT_FOUND' || error.code === 'APPROVED_ANCHOR_INCOMPLETE')) {
      items.push({
        key: 'approved_anchors',
        label: 'Approved Anchors',
        state: 'invalid_reference',
        blocking: true,
        message: error.message,
        ...(typeof error.details?.path === 'string' ? { path: error.details.path } : {}),
      });
      return finalize(entry.project_id, items);
    }
    if (error instanceof VisualDirectorError && error.code === 'CANON_READ_FAILED') {
      items.push({
        key: 'visual_canon',
        label: 'Visual Canon',
        state: 'required_missing',
        blocking: true,
        message: error.message,
        ...(typeof error.details?.path === 'string' ? { path: error.details.path } : {}),
      });
      return finalize(entry.project_id, items);
    }
    throw error;
  }

  return finalize(entry.project_id, items);
}

function diagnosticDocuments(entry: ProjectCatalogEntry): ProjectDocuments {
  if (entry.project_id === crownlessDefinition.projectId) return crownlessDefinition.documents;
  return DEFAULT_PROJECT_DOCUMENTS;
}

async function diagnoseBottomOfThirstAnchors(source: RepositorySource, items: ProjectDiagnosticItem[]): Promise<void> {
  const canon = await source.readText(DEFAULT_PROJECT_DOCUMENTS.characterCanon, 'Character Visual Canon');
  let definitions = 0;
  for (const subjectId of configuredSubjects()) {
    const configured = bottomOfThirstCanonSubject(subjectId);
    if (!configured) continue;
    const anchorSection = subsection(section(canon, configured.canonHeading), 'Approved Visual Anchor');
    const paths = approvedAnchorPaths(anchorSection);
    const primary = paths[0];
    if (!primary) {
      items.push({
        key: `approved_anchor:${subjectId}`,
        label: `Approved Anchor: ${configured.canonHeading}`,
        state: 'required_missing',
        blocking: true,
        message: `Approved Anchor is not defined for ${subjectId}.`,
      });
      continue;
    }
    definitions += 1;
    await source.ensureFile(primary, `Approved Anchor for ${subjectId}`);
    const fallback = paths[1];
    if (fallback && !(await source.fileExists(fallback))) {
      throw new VisualDirectorError('APPROVED_ANCHOR_INCOMPLETE', `Same-generation fallback is missing for ${subjectId}.`, {
        subject_id: subjectId,
        path: fallback,
      });
    }
  }
  if (!items.some((item) => item.key.startsWith('approved_anchor:') && item.blocking)) {
    items.push({
      key: 'approved_anchors',
      label: 'Approved Anchors',
      state: 'ready',
      blocking: false,
      message: `${definitions} Approved Anchor definitions and referenced files are valid.`,
    });
  }
}

async function diagnoseOverviewReferences(
  loadOverview: () => Promise<ProjectVisualOverview>,
  items: ProjectDiagnosticItem[],
): Promise<void> {
  try {
    const overview = await loadOverview();
    items.push({
      key: 'approved_anchors',
      label: 'Approved Anchors',
      state: 'ready',
      blocking: false,
      message: `${overview.approved_anchors.length} Approved Anchors resolved.`,
    });
  } catch (error) {
    if (error instanceof VisualDirectorError && (error.code === 'REFERENCE_NOT_FOUND' || error.code === 'APPROVED_ANCHOR_INCOMPLETE')) {
      items.push({
        key: 'approved_anchors',
        label: 'Approved Anchors',
        state: 'invalid_reference',
        blocking: true,
        message: error.message,
        ...(typeof error.details?.path === 'string' ? { path: error.details.path } : {}),
      });
      return;
    }
    throw error;
  }
}

async function safeOverview(loadOverview: () => Promise<ProjectVisualOverview>): Promise<ProjectVisualOverview | null> {
  try {
    return await loadOverview();
  } catch {
    return null;
  }
}

function finalize(projectId: string, items: ProjectDiagnosticItem[]): ProjectDiagnostics {
  const state = items.some((item) => item.state === 'access_error')
    ? 'access_error'
    : items.some((item) => item.state === 'invalid_reference')
      ? 'invalid_reference'
      : items.some((item) => item.state === 'required_missing')
        ? 'required_missing'
        : 'ready';
  return {
    project_id: projectId,
    state,
    usable: state === 'ready',
    items,
  };
}
