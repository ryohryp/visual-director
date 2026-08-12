import { access } from 'node:fs/promises';
import path from 'node:path';

import { bullets, bulletsAfterLabel, fencedBlock, readUtf8File, section, subsection } from '../../domain/markdown.js';
import { VisualDirectorError } from '../../domain/types.js';
import type { GenerationPackage, PrepareGenerationInput, ProjectAdapter, ReferenceAsset } from '../../domain/types.js';

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
  repoPath: string;
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

interface SubjectAnchor extends ProjectSubjectDefinition {
  anchorPath: string;
  canonSection: string;
  characterMarkdown: string;
}

export class CanonProjectAdapter implements ProjectAdapter {
  readonly projectId: string;
  private readonly repoPath: string;
  private readonly definition: CanonProjectDefinition;

  constructor(definition: CanonProjectDefinition, options: CanonProjectAdapterOptions) {
    this.projectId = definition.projectId;
    this.definition = definition;
    this.repoPath = path.resolve(options.repoPath);
  }

  async prepare(input: PrepareGenerationInput): Promise<GenerationPackage> {
    this.validateInput(input);
    const documents = this.definition.documents;
    const [styleMarkdown, canonMarkdown, worldMarkdown, manifestMarkdown] = await Promise.all([
      readUtf8File(this.resolvePath(documents.globalStyle), 'Global Visual Style'),
      readUtf8File(this.resolvePath(documents.characterCanon), 'Character Visual Canon'),
      readUtf8File(this.resolvePath(documents.worldDirection), 'World Direction'),
      readUtf8File(this.resolvePath(documents.assetManifest), 'Visual reference asset manifest'),
    ]);
    if (!manifestMarkdown.trim()) {
      throw new VisualDirectorError('ASSET_MANIFEST_EMPTY', 'Visual reference asset manifest is empty.', {
        path: documents.assetManifest,
      });
    }

    const subjects = await Promise.all(input.subject_ids.map((subjectId) => this.loadSubject(subjectId, canonMarkdown)));
    await ensureFile(this.resolvePath(documents.globalReference), 'Global Visual Reference');
    const styleLock = fencedBlock(styleMarkdown, 'text');
    const avoidBlock = fencedBlockAfter(styleMarkdown, this.definition.labels.avoidBlockHeading);
    if (!styleLock || !avoidBlock) {
      throw new VisualDirectorError('GLOBAL_STYLE_INCOMPLETE', 'Global Visual Style is missing a style lock or avoid block.');
    }

    return {
      project_id: this.projectId,
      asset_type: input.asset_type,
      prompt_package: {
        style_lock: styleLock,
        subject_lock: subjects.map((subject) => this.subjectLock(subject)),
        scene_requirements: this.sceneRequirements(input, worldMarkdown),
        allowed_changes: bulletsAfterLabel(styleMarkdown, this.definition.labels.allowedChangesHeading),
        forbidden_changes: this.forbiddenChanges(canonMarkdown, styleMarkdown),
        avoid_block: avoidBlock.split(',').map((item) => item.trim().replace(/^AVOID:\s*/i, '')).filter(Boolean),
      },
      reference_assets: [
        { role: 'global_reference', path: documents.globalReference },
        ...subjects.map<ReferenceAsset>((subject) => ({
          role: 'subject_anchor',
          subject_id: subject.id,
          path: subject.anchorPath,
        })),
      ],
      policy: {
        must_use_approved_anchor: true,
        must_not_chain_from_candidate: true,
        must_review_after_generation: true,
      },
    };
  }

  private validateInput(input: PrepareGenerationInput): void {
    if (input.project_id !== this.projectId) {
      throw new VisualDirectorError('PROJECT_NOT_FOUND', `Unsupported project_id: ${input.project_id}.`);
    }
    if (!input.asset_type.trim() || !input.request_text.trim()) {
      throw new VisualDirectorError('INVALID_INPUT', 'asset_type and request_text must not be empty.');
    }
    if (input.subject_ids.length === 0) {
      throw new VisualDirectorError('INVALID_INPUT', 'At least one subject_id is required.');
    }
    for (const subjectId of input.subject_ids) {
      if (!this.definition.subjects[subjectId]) {
        throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${subjectId}.`, {
          subject_id: subjectId,
          known_subject_ids: Object.keys(this.definition.subjects),
        });
      }
    }
  }

  private async loadSubject(subjectId: string, canonMarkdown: string): Promise<SubjectAnchor> {
    const configured = this.definition.subjects[subjectId];
    if (!configured) {
      throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${subjectId}.`);
    }
    const canonSection = section(canonMarkdown, configured.canonHeading);
    const anchorSection = subsection(canonSection, 'Approved Visual Anchor');
    const anchorPath = approvedAnchorPaths(anchorSection)[0];
    if (!anchorPath) {
      throw new VisualDirectorError('APPROVED_ANCHOR_NOT_FOUND', `Approved Anchor path is missing for ${subjectId}.`, {
        subject_id: subjectId,
      });
    }
    await ensureFile(this.resolvePath(anchorPath), `Approved Anchor for ${subjectId}`);
    const characterMarkdown = await readUtf8File(
      this.resolvePath(configured.characterFile),
      `Character facts for ${subjectId}`,
    );
    return { ...configured, anchorPath, canonSection, characterMarkdown };
  }

  private subjectLock(subject: SubjectAnchor): string {
    const accepted = bullets(subsection(subject.canonSection, this.definition.labels.acceptedConditionsHeading));
    const canonicalState = subsection(subject.canonSection, 'Canonical state model');
    const facts = bullets(subject.characterMarkdown).slice(0, 8);
    return `${subject.displayName} (${subject.id}) - Approved Visual Anchor: ${subject.anchorPath}. ${accepted.join(' ')} ${facts.join(' ')}${canonicalState ? ` Canonical state: ${canonicalState}` : ''}`.trim();
  }

  private sceneRequirements(input: PrepareGenerationInput, worldMarkdown: string): string[] {
    const context = Object.entries(input.scene_context ?? {}).map(([key, value]) => `${key}: ${String(value)}`).join(', ');
    return [
      `Asset type: ${input.asset_type}.`,
      `Narrative request: ${input.request_text.trim()}`,
      ...(context ? [`Scene context: ${context}`] : []),
      ...bullets(worldMarkdown).slice(0, 8).map((rule) => `World direction: ${rule}`),
    ];
  }

  private forbiddenChanges(canonMarkdown: string, styleMarkdown: string): string[] {
    return [
      'Do not use legacy, transitional, archived late-state, or exploration-only assets as the generation parent.',
      'Do not chain a new variation from a candidate or derived variation; return to the Approved Visual Anchor.',
      'Do not silently fall back to an older generation when an approved asset cannot be read.',
      ...bulletsAfterLabel(styleMarkdown, this.definition.labels.forbiddenChangesHeading),
      ...bullets(section(canonMarkdown, this.definition.labels.commonRulesHeading)),
    ];
  }

  private resolvePath(relativePath: string): string {
    const root = path.resolve(this.repoPath);
    const resolved = path.resolve(this.repoPath, relativePath);
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (path.isAbsolute(relativePath) || (resolved !== root && !resolved.startsWith(prefix))) {
      throw new VisualDirectorError('REFERENCE_OUTSIDE_REPO', 'A configured project path resolves outside the project repository.', {
        path: relativePath,
      });
    }
    return resolved;
  }
}

export function approvedAnchorPaths(anchorSection: string): string[] {
  const paths: string[] = [];
  for (const line of anchorSection.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+`([^`]+)`\s*$/);
    if (match?.[1]) {
      paths.push(match[1]);
      continue;
    }
    if (line.trim() !== '') break;
  }
  return paths;
}

function fencedBlockAfter(markdown: string, heading: string): string {
  const index = markdown.indexOf(heading);
  return index < 0 ? '' : fencedBlock(markdown.slice(index), 'text');
}

async function ensureFile(filePath: string, label: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new VisualDirectorError('REFERENCE_NOT_FOUND', `${label} does not exist.`, { path: filePath });
  }
}
