import { access } from 'node:fs/promises';
import path from 'node:path';

import { bullets, bulletsAfterLabel, fencedBlock, readUtf8File, section, subsection } from '../../domain/markdown.js';
import {
  GenerationPackage,
  PrepareGenerationInput,
  ProjectAdapter,
  ReferenceAsset,
  VisualDirectorError,
} from '../../domain/types.js';

const PROJECT_ID = 'bottom-of-thirst';
const GLOBAL_STYLE = 'docs/visual/GLOBAL_VISUAL_STYLE.md';
const CANON = 'docs/visual/CHARACTER_VISUAL_CANON.md';
const GLOBAL_REFERENCE = 'docs/visual/assets/global_visual_style_reference.webp';

interface SubjectAnchor {
  id: string;
  displayName: string;
  characterFile: string;
  canonHeading: string;
  anchorPath: string;
  anchorFallback?: string;
  canonSection: string;
  characterMarkdown: string;
}

interface SubjectConfig {
  id: string;
  displayName: string;
  characterFile: string;
  canonHeading: string;
}

const SUBJECTS: Record<string, SubjectConfig> = {
  souma: {
    id: 'souma',
    displayName: '相馬 健人',
    characterFile: 'docs/characters/soma.md',
    canonHeading: '相馬 健人',
  },
  saya: {
    id: 'saya',
    displayName: '水上 沙耶',
    characterFile: 'docs/characters/saya.md',
    canonHeading: '水上 沙耶',
  },
  hikawa_ruka: {
    id: 'hikawa_ruka',
    displayName: '氷川 瑠花',
    characterFile: 'docs/characters/hikawa.md',
    canonHeading: '氷川 瑠花',
  },
  kagami: {
    id: 'kagami',
    displayName: '鏡 玲央',
    characterFile: 'docs/characters/kagami.md',
    canonHeading: '鏡 玲央',
  },
  kitou: {
    id: 'kitou',
    displayName: '鬼頭 厳山',
    characterFile: 'docs/characters/kito.md',
    canonHeading: '鬼頭 厳山',
  },
};

export interface BottomOfThirstAdapterOptions {
  repoPath: string;
}

export class BottomOfThirstAdapter implements ProjectAdapter {
  readonly projectId = PROJECT_ID;
  private readonly repoPath: string;

  constructor(options: BottomOfThirstAdapterOptions) {
    this.repoPath = path.resolve(options.repoPath);
  }

  async prepare(input: PrepareGenerationInput): Promise<GenerationPackage> {
    this.validateInput(input);

    const [styleMarkdown, canonMarkdown, worldMarkdown] = await Promise.all([
      readUtf8File(path.join(this.repoPath, GLOBAL_STYLE), 'Global Visual Style'),
      readUtf8File(path.join(this.repoPath, CANON), 'Character Visual Canon'),
      readUtf8File(path.join(this.repoPath, 'docs/WORLD_DIRECTION.md'), 'World Direction'),
    ]);

    const referenceAssets = await this.resolveReferences(input.subject_ids, canonMarkdown);
    const subjects = await Promise.all(
      input.subject_ids.map((subjectId) => this.loadSubject(subjectId, canonMarkdown)),
    );
    const globalReference = path.join(this.repoPath, GLOBAL_REFERENCE);
    await ensureFile(globalReference, 'Global Visual Reference');

    const globalStyleLock = fencedBlock(styleMarkdown, 'text');
    const avoidBlock = fencedBlockAfter(styleMarkdown, 'Fixed Avoid Block');
    if (!globalStyleLock || !avoidBlock) {
      throw new VisualDirectorError(
        'GLOBAL_STYLE_INCOMPLETE',
        'Global Visual Style is missing the required Global Visual Style Lock or Fixed Avoid Block.',
      );
    }

    return {
      project_id: PROJECT_ID,
      asset_type: input.asset_type,
      prompt_package: {
        style_lock: globalStyleLock,
        subject_lock: subjects.map((subject) => this.subjectLock(subject)),
        scene_requirements: this.sceneRequirements(input, worldMarkdown),
        allowed_changes: this.allowedChanges(styleMarkdown),
        forbidden_changes: this.forbiddenChanges(canonMarkdown, styleMarkdown),
        avoid_block: avoidBlock
          .split(',')
          .map((item) => item.trim().replace(/^AVOID:\s*/i, ''))
          .filter(Boolean),
      },
      reference_assets: [
        { role: 'global_reference', path: GLOBAL_REFERENCE },
        ...referenceAssets,
      ],
      policy: {
        must_use_approved_anchor: true,
        must_not_chain_from_candidate: true,
        must_review_after_generation: true,
      },
    };
  }

  private validateInput(input: PrepareGenerationInput): void {
    if (input.project_id !== PROJECT_ID) {
      throw new VisualDirectorError('PROJECT_NOT_FOUND', `Unsupported project_id: ${input.project_id}.`);
    }
    if (!input.asset_type.trim()) {
      throw new VisualDirectorError('INVALID_INPUT', 'asset_type must not be empty.');
    }
    if (!input.request_text.trim()) {
      throw new VisualDirectorError('INVALID_INPUT', 'request_text must not be empty.');
    }
    if (input.subject_ids.length === 0) {
      throw new VisualDirectorError('INVALID_INPUT', 'At least one subject_id is required.');
    }
    for (const subjectId of input.subject_ids) {
      if (!SUBJECTS[subjectId]) {
        throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${subjectId}.`, {
          subject_id: subjectId,
          known_subject_ids: Object.keys(SUBJECTS),
        });
      }
    }
  }

  private async loadSubject(subjectId: string, canonMarkdown: string): Promise<SubjectAnchor> {
    const configured = SUBJECTS[subjectId];
    if (!configured) {
      throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${subjectId}.`);
    }
    const canonSection = characterSection(canonMarkdown, configured.canonHeading);
    if (!canonSection || !canonSection.includes('Approved Visual Anchor')) {
      throw new VisualDirectorError('APPROVED_ANCHOR_NOT_FOUND', `Approved Anchor is not defined for ${subjectId}.`, {
        subject_id: subjectId,
      });
    }
    const anchorSection = subsection(canonSection, 'Approved Visual Anchor');
    const anchorPaths = [...anchorSection.matchAll(/^-\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
    const anchorPath = anchorPaths[0];
    const anchorFallback = anchorPaths[1];
    if (!anchorPath) {
      throw new VisualDirectorError('APPROVED_ANCHOR_NOT_FOUND', `Approved Anchor path is missing for ${subjectId}.`, {
        subject_id: subjectId,
      });
    }
    const absoluteAnchorPath = resolveRepoPath(this.repoPath, anchorPath);
    await ensureFile(absoluteAnchorPath, `Approved Anchor for ${subjectId}`);
    if (anchorFallback && !(await exists(resolveRepoPath(this.repoPath, anchorFallback)))) {
        throw new VisualDirectorError('APPROVED_ANCHOR_INCOMPLETE', `Same-generation fallback is missing for ${subjectId}.`, {
          subject_id: subjectId,
          path: anchorFallback,
        });
    }
    const characterMarkdown = await readUtf8File(path.join(this.repoPath, configured.characterFile), `Character facts for ${subjectId}`);
    return { ...configured, anchorPath, anchorFallback, canonSection, characterMarkdown };
  }

  private async resolveReferences(subjectIds: string[], canonMarkdown: string): Promise<ReferenceAsset[]> {
    const references: ReferenceAsset[] = [];
    for (const subjectId of subjectIds) {
      const subject = await this.loadSubject(subjectId, canonMarkdown);
      references.push({ role: 'subject_anchor', subject_id: subject.id, path: subject.anchorPath });
    }
    return references;
  }

  private subjectLock(subject: SubjectAnchor): string {
    const accepted = bullets(subsection(subject.canonSection, '採用する視覚条件'));
    const canonicalState = subsection(subject.canonSection, 'Canonical state model');
    const facts = bullets(subject.characterMarkdown).slice(0, 8);
    const state = canonicalState ? ` Canonical state: ${canonicalState}` : '';
    return `${subject.displayName} (${subject.id}) — Approved Visual Anchor: ${subject.anchorPath}. ${accepted.join(' ')} ${facts.join(' ')}${state}`.trim();
  }

  private sceneRequirements(input: PrepareGenerationInput, worldMarkdown: string): string[] {
    const context = Object.entries(input.scene_context ?? {})
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ');
    const worldRules = bullets(worldMarkdown).slice(0, 8);
    return [
      `Asset type: ${input.asset_type}.`,
      `Narrative request: ${input.request_text.trim()}`,
      ...(context ? [`Scene context: ${context}`] : []),
      ...worldRules.map((rule) => `World direction: ${rule}`),
    ];
  }

  private allowedChanges(styleMarkdown: string): string[] {
    return bulletsAfterLabel(styleMarkdown, '変更してよいもの');
  }

  private forbiddenChanges(canonMarkdown: string, styleMarkdown: string): string[] {
    const common = bullets(section(canonMarkdown, '共通ルール'));
    const global = [
      'Do not use legacy, transitional, archived late-state, or exploration-only assets as the generation parent.',
      'Do not chain a new variation from a candidate or derived variation; return to the Approved Visual Anchor.',
      'Do not silently fall back to an older generation when an approved asset cannot be read.',
    ];
    return [...global, ...bulletsAfterLabel(styleMarkdown, '変更してはいけないもの'), ...common];
  }
}

function fencedBlockAfter(markdown: string, heading: string): string {
  const index = markdown.indexOf(heading);
  return index < 0 ? '' : fencedBlock(markdown.slice(index), 'text');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureFile(filePath: string, label: string): Promise<void> {
  if (!(await exists(filePath))) {
    throw new VisualDirectorError('REFERENCE_NOT_FOUND', `${label} does not exist.`, { path: filePath });
  }
}

export function configuredSubjects(): string[] {
  return Object.keys(SUBJECTS);
}

function characterSection(markdown: string, heading: string): string {
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'm');
  const match = headingPattern.exec(markdown);
  if (!match || match.index === undefined) return '';
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const nextCharacter = rest.search(/^##\s+(?:水上 沙耶|相馬 健人|氷川 瑠花|鏡 玲央|鬼頭 厳山)\s*$/m);
  const nextTopLevel = rest.search(/^##\s+/m);
  const boundaries = [nextCharacter, nextTopLevel].filter((index) => index >= 0);
  const end = boundaries.length > 0 ? Math.min(...boundaries) : rest.length;
  return rest.slice(0, end).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveRepoPath(repoPath: string, relativePath: string): string {
  const resolvedRepoPath = path.resolve(repoPath);
  const resolvedPath = path.resolve(repoPath, relativePath);
  const repoPrefix = resolvedRepoPath.endsWith(path.sep) ? resolvedRepoPath : `${resolvedRepoPath}${path.sep}`;
  if (resolvedPath !== resolvedRepoPath && !resolvedPath.startsWith(repoPrefix)) {
    throw new VisualDirectorError('REFERENCE_OUTSIDE_REPO', 'A Canon reference resolves outside the configured project repository.', {
      path: relativePath,
    });
  }
  return resolvedPath;
}
