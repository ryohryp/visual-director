import { access } from 'node:fs/promises';
import path from 'node:path';

import { bullets, fencedBlock, readUtf8File } from '../../domain/markdown.js';
import { VisualDirectorError } from '../../domain/types.js';
import type { GenerationPackage, PrepareGenerationInput, ProjectAdapter } from '../../domain/types.js';
import type { ProjectDocuments, ProjectLabels } from './types.js';

export type CanonSubjectMode = 'approved_anchor' | 'new_anchor_candidate';

export interface CanonSubject {
  id: string;
  displayName: string;
  anchorPath?: string;
  anchorFallback?: string;
  canonSection: string;
  characterMarkdown: string;
  requirementsMarkdown?: string;
  mode?: CanonSubjectMode;
}

interface CanonAdapterBaseOptions {
  projectId: string;
  repoPath: string;
  documents: ProjectDocuments;
  labels: ProjectLabels;
  subjectIds: readonly string[];
}

interface CanonDocuments {
  styleMarkdown: string;
  canonMarkdown: string;
  worldMarkdown: string;
}

const GLOBAL_FORBIDDEN_CHANGES = [
  'Do not use legacy, transitional, archived late-state, or exploration-only assets as the generation parent.',
  'Do not chain a new variation from a candidate or derived variation; return to the Approved Visual Anchor.',
  'Do not silently fall back to an older generation when an approved asset cannot be read.',
];

export abstract class CanonAdapterBase implements ProjectAdapter {
  readonly projectId: string;
  protected readonly repoPath: string;
  protected readonly documents: ProjectDocuments;
  protected readonly labels: ProjectLabels;
  private readonly subjectIds: readonly string[];

  protected constructor(options: CanonAdapterBaseOptions) {
    this.projectId = options.projectId;
    this.repoPath = path.resolve(options.repoPath);
    this.documents = options.documents;
    this.labels = options.labels;
    this.subjectIds = options.subjectIds;
  }

  async prepare(input: PrepareGenerationInput): Promise<GenerationPackage> {
    this.validateInput(input);

    const documents = await this.readDocuments();
    const subjects = await Promise.all(
      input.subject_ids.map((subjectId) => this.loadSubject(subjectId, documents.canonMarkdown, input.asset_type)),
    );
    const preparingNewAnchor = subjects.some((subject) => subject.mode === 'new_anchor_candidate');
    if (preparingNewAnchor && (input.asset_type !== this.newAnchorAssetType() || subjects.length !== 1)) {
      throw new VisualDirectorError(
        'NEW_ANCHOR_CONTEXT_INVALID',
        'A new Visual Anchor candidate must be prepared as a single-subject character_visual_anchor request.',
        { subject_ids: input.subject_ids, asset_type: input.asset_type },
      );
    }
    await this.ensureFile(this.resolvePath(this.documents.globalReference), 'Global Visual Reference');

    const styleLock = fencedBlock(documents.styleMarkdown, 'text');
    const avoidBlock = fencedBlockAfter(documents.styleMarkdown, this.labels.avoidBlockHeading);
    if (!styleLock || !avoidBlock) {
      throw new VisualDirectorError('GLOBAL_STYLE_INCOMPLETE', this.globalStyleIncompleteMessage());
    }

    return {
      project_id: this.projectId,
      asset_type: input.asset_type,
      prompt_package: {
        style_lock: styleLock,
        subject_lock: subjects.map((subject) => this.subjectLock(subject)),
        scene_requirements: this.sceneRequirements(input, documents.worldMarkdown),
        allowed_changes: this.allowedChanges(documents.styleMarkdown, preparingNewAnchor),
        forbidden_changes: this.forbiddenChanges(documents.canonMarkdown, documents.styleMarkdown, preparingNewAnchor),
        avoid_block: splitAvoidBlock(avoidBlock),
      },
      reference_assets: [
        { role: 'global_reference', path: this.documents.globalReference },
        ...subjects.flatMap((subject) =>
          subject.anchorPath
            ? [{ role: 'subject_anchor' as const, subject_id: subject.id, path: subject.anchorPath }]
            : [],
        ),
      ],
      policy: generationPolicy(preparingNewAnchor),
    };
  }

  protected abstract loadSubject(subjectId: string, canonMarkdown: string, assetType?: string): Promise<CanonSubject>;

  protected abstract subjectLock(subject: CanonSubject, preparingNewAnchor?: boolean): string;

  protected abstract allowedChanges(styleMarkdown: string, preparingNewAnchor?: boolean): string[];

  protected abstract forbiddenChanges(
    canonMarkdown: string,
    styleMarkdown: string,
    preparingNewAnchor?: boolean,
  ): string[];

  protected newAnchorAssetType(): string {
    return 'character_visual_anchor';
  }

  protected validateInput(input: PrepareGenerationInput): void {
    if (input.project_id !== this.projectId) {
      throw new VisualDirectorError('PROJECT_NOT_FOUND', `Unsupported project_id: ${input.project_id}.`);
    }
    this.validateTextInput(input);
    if (input.subject_ids.length === 0) {
      throw new VisualDirectorError('INVALID_INPUT', 'At least one subject_id is required.');
    }
    for (const subjectId of input.subject_ids) {
      if (!this.subjectIds.includes(subjectId)) {
        throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${subjectId}.`, {
          subject_id: subjectId,
          known_subject_ids: [...this.subjectIds],
        });
      }
    }
  }

  protected validateTextInput(input: PrepareGenerationInput): void {
    if (!input.asset_type.trim() || !input.request_text.trim()) {
      throw new VisualDirectorError('INVALID_INPUT', 'asset_type and request_text must not be empty.');
    }
  }

  protected globalStyleIncompleteMessage(): string {
    return 'Global Visual Style is missing a style lock or avoid block.';
  }

  protected resolvePath(relativePath: string): string {
    const root = this.repoPath;
    const resolved = path.resolve(root, relativePath);
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (path.isAbsolute(relativePath) || (resolved !== root && !resolved.startsWith(prefix))) {
      throw new VisualDirectorError('REFERENCE_OUTSIDE_REPO', 'A configured project path resolves outside the project repository.', {
        path: relativePath,
      });
    }
    return resolved;
  }

  protected async ensureFile(filePath: string, label: string): Promise<void> {
    try {
      await access(filePath);
    } catch {
      throw new VisualDirectorError('REFERENCE_NOT_FOUND', `${label} does not exist.`, { path: filePath });
    }
  }

  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async readDocuments(): Promise<CanonDocuments> {
    const [styleMarkdown, canonMarkdown, worldMarkdown, manifestMarkdown] = await Promise.all([
      readUtf8File(this.resolvePath(this.documents.globalStyle), 'Global Visual Style'),
      readUtf8File(this.resolvePath(this.documents.characterCanon), 'Character Visual Canon'),
      readUtf8File(this.resolvePath(this.documents.worldDirection), 'World Direction'),
      readUtf8File(this.resolvePath(this.documents.assetManifest), 'Visual reference asset manifest'),
    ]);
    if (!manifestMarkdown.trim()) {
      throw new VisualDirectorError('ASSET_MANIFEST_EMPTY', 'Visual reference asset manifest is empty.', {
        path: this.documents.assetManifest,
      });
    }
    return { styleMarkdown, canonMarkdown, worldMarkdown };
  }

  private sceneRequirements(input: PrepareGenerationInput, worldMarkdown: string): string[] {
    const context = Object.entries(input.scene_context ?? {})
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ');
    return [
      `Asset type: ${input.asset_type}.`,
      `Narrative request: ${input.request_text.trim()}`,
      ...(context ? [`Scene context: ${context}`] : []),
      ...bullets(worldMarkdown).slice(0, 8).map((rule) => `World direction: ${rule}`),
    ];
  }
}

function fencedBlockAfter(markdown: string, heading: string): string {
  const index = markdown.indexOf(heading);
  return index < 0 ? '' : fencedBlock(markdown.slice(index), 'text');
}

function splitAvoidBlock(avoidBlock: string): string[] {
  return avoidBlock
    .split(',')
    .map((item) => item.trim().replace(/^AVOID:\s*/i, ''))
    .filter(Boolean);
}

function generationPolicy(preparingNewAnchor: boolean): GenerationPackage['policy'] {
  return {
    must_use_approved_anchor: !preparingNewAnchor,
    must_not_chain_from_candidate: true,
    must_review_after_generation: true,
  };
}

export function globalForbiddenChanges(): string[] {
  return [...GLOBAL_FORBIDDEN_CHANGES];
}
