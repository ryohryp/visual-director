import { access } from 'node:fs/promises';
import path from 'node:path';

import { bullets, bulletsAfterLabel, fencedBlock, readUtf8File, section, subsection } from '../../domain/markdown.js';
import { VisualDirectorError } from '../../domain/types.js';
import type {
  GenerationPackage,
  PrepareGenerationInput,
  ProjectAdapter,
  ReferenceAsset,
} from '../../domain/types.js';

const PROJECT_ID = 'bottom-of-thirst';
const GLOBAL_STYLE = 'docs/visual/GLOBAL_VISUAL_STYLE.md';
const CANON = 'docs/visual/CHARACTER_VISUAL_CANON.md';
const ASSET_README = 'docs/visual/assets/README.md';
const GLOBAL_REFERENCE = 'docs/visual/assets/global_visual_style_reference.webp';
const NEW_ANCHOR_ASSET_TYPE = 'character_visual_anchor';

type SubjectGenerationMode = 'approved_anchor' | 'new_anchor_candidate';

interface SubjectMaterial {
  id: string;
  displayName: string;
  characterFile: string;
  canonHeading: string;
  anchorRequirementsFile?: string;
  anchorPath?: string;
  anchorFallback?: string;
  canonSection: string;
  characterMarkdown: string;
  requirementsMarkdown?: string;
  mode: SubjectGenerationMode;
}

interface SubjectConfig {
  id: string;
  displayName: string;
  characterFile: string;
  canonHeading: string;
  anchorRequirementsFile?: string;
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
  mikoshiba: {
    id: 'mikoshiba',
    displayName: '御子柴 徹',
    characterFile: 'docs/characters/mikoshiba.md',
    canonHeading: '御子柴 徹',
    anchorRequirementsFile: 'docs/visual/MIKOSHIBA_VISUAL_ANCHOR_V2_REQUIREMENTS.md',
  },
  kamino_kyosuke: {
    id: 'kamino_kyosuke',
    displayName: '神野 恭介',
    characterFile: 'docs/characters/kyosuke.md',
    canonHeading: '神野 恭介',
    anchorRequirementsFile: 'docs/visual/KAMINO_KYOSUKE_VISUAL_ANCHOR_V2_REQUIREMENTS.md',
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

    const [styleMarkdown, canonMarkdown, worldMarkdown, assetReadmeMarkdown] = await Promise.all([
      readUtf8File(path.join(this.repoPath, GLOBAL_STYLE), 'Global Visual Style'),
      readUtf8File(path.join(this.repoPath, CANON), 'Character Visual Canon'),
      readUtf8File(path.join(this.repoPath, 'docs/WORLD_DIRECTION.md'), 'World Direction'),
      readUtf8File(path.join(this.repoPath, ASSET_README), 'Visual reference asset manifest'),
    ]);
    if (!assetReadmeMarkdown.trim()) {
      throw new VisualDirectorError('ASSET_MANIFEST_EMPTY', 'Visual reference asset manifest is empty.', {
        path: ASSET_README,
      });
    }

    const subjects = await Promise.all(
      input.subject_ids.map((subjectId) => this.loadSubject(subjectId, canonMarkdown, input.asset_type)),
    );
    const newAnchorSubjects = subjects.filter((subject) => subject.mode === 'new_anchor_candidate');
    if (newAnchorSubjects.length > 0 && (input.asset_type !== NEW_ANCHOR_ASSET_TYPE || subjects.length !== 1)) {
      throw new VisualDirectorError(
        'NEW_ANCHOR_CONTEXT_INVALID',
        'A new Visual Anchor candidate must be prepared as a single-subject character_visual_anchor request.',
        { subject_ids: input.subject_ids, asset_type: input.asset_type },
      );
    }

    const referenceAssets = subjects.flatMap<ReferenceAsset>((subject) =>
      subject.anchorPath
        ? [{ role: 'subject_anchor', subject_id: subject.id, path: subject.anchorPath }]
        : [],
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

    const preparingNewAnchor = newAnchorSubjects.length === 1;
    return {
      project_id: PROJECT_ID,
      asset_type: input.asset_type,
      prompt_package: {
        style_lock: globalStyleLock,
        subject_lock: subjects.map((subject) => this.subjectLock(subject)),
        scene_requirements: this.sceneRequirements(input, worldMarkdown),
        allowed_changes: preparingNewAnchor
          ? [
              'Create the initial identity and default silhouette for this subject only.',
              'Choose face, hair, body proportions, clothing details, pose, and subject props only within the authoritative character and Visual Anchor requirements.',
            ]
          : this.allowedChanges(styleMarkdown),
        forbidden_changes: this.forbiddenChanges(canonMarkdown, styleMarkdown, preparingNewAnchor),
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
        must_use_approved_anchor: !preparingNewAnchor,
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

  private async loadSubject(
    subjectId: string,
    canonMarkdown: string,
    assetType: string,
  ): Promise<SubjectMaterial> {
    const configured = SUBJECTS[subjectId];
    if (!configured) {
      throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${subjectId}.`);
    }

    const characterMarkdown = await readUtf8File(
      path.join(this.repoPath, configured.characterFile),
      `Character facts for ${subjectId}`,
    );
    const canonSection = characterSection(canonMarkdown, configured.canonHeading);
    const anchorSection = canonSection ? subsection(canonSection, 'Approved Visual Anchor') : '';
    const anchorPaths = approvedAnchorPaths(anchorSection);
    const anchorPath = anchorPaths[0];
    const anchorFallback = anchorPaths[1];

    if (anchorPath) {
      const absoluteAnchorPath = resolveRepoPath(this.repoPath, anchorPath);
      await ensureFile(absoluteAnchorPath, `Approved Anchor for ${subjectId}`);
      if (anchorFallback && !(await exists(resolveRepoPath(this.repoPath, anchorFallback)))) {
        throw new VisualDirectorError('APPROVED_ANCHOR_INCOMPLETE', `Same-generation fallback is missing for ${subjectId}.`, {
          subject_id: subjectId,
          path: anchorFallback,
        });
      }
      return {
        ...configured,
        anchorPath,
        anchorFallback,
        canonSection,
        characterMarkdown,
        mode: 'approved_anchor',
      };
    }

    if (assetType !== NEW_ANCHOR_ASSET_TYPE) {
      throw new VisualDirectorError('APPROVED_ANCHOR_NOT_FOUND', `Approved Anchor is not defined for ${subjectId}.`, {
        subject_id: subjectId,
        required_asset_type_for_new_anchor: NEW_ANCHOR_ASSET_TYPE,
      });
    }
    if (!configured.anchorRequirementsFile) {
      throw new VisualDirectorError(
        'NEW_ANCHOR_REQUIREMENTS_NOT_CONFIGURED',
        `New Visual Anchor requirements are not configured for ${subjectId}.`,
        { subject_id: subjectId },
      );
    }

    const requirementsMarkdown = await readUtf8File(
      path.join(this.repoPath, configured.anchorRequirementsFile),
      `Visual Anchor requirements for ${subjectId}`,
    );
    if (!requirementsMarkdown.trim()) {
      throw new VisualDirectorError('NEW_ANCHOR_REQUIREMENTS_EMPTY', `Visual Anchor requirements are empty for ${subjectId}.`, {
        subject_id: subjectId,
        path: configured.anchorRequirementsFile,
      });
    }

    return {
      ...configured,
      canonSection,
      characterMarkdown,
      requirementsMarkdown,
      mode: 'new_anchor_candidate',
    };
  }

  private subjectLock(subject: SubjectMaterial): string {
    if (subject.mode === 'new_anchor_candidate') {
      const facts = bullets(subject.characterMarkdown).slice(0, 16);
      return [
        `${subject.displayName} (${subject.id}) — NEW VISUAL ANCHOR CANDIDATE.`,
        'No Approved Visual Anchor exists for this subject. Do not use, imitate, merge, or borrow the face, hair, body, clothing, pose, props, or silhouette of any other character as an identity reference.',
        `Character facts: ${facts.join(' ')}`,
        'AUTHORITATIVE NEW-ANCHOR REQUIREMENTS:',
        subject.requirementsMarkdown?.trim() ?? '',
      ].join('\n\n');
    }

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

  private forbiddenChanges(
    canonMarkdown: string,
    styleMarkdown: string,
    preparingNewAnchor: boolean,
  ): string[] {
    const common = bullets(section(canonMarkdown, '共通ルール'));
    const global = [
      'Do not use legacy, transitional, archived late-state, or exploration-only assets as the generation parent.',
      'Do not chain a new variation from a candidate or derived variation; return to the Approved Visual Anchor.',
      'Do not silently fall back to an older generation when an approved asset cannot be read.',
    ];
    const newAnchorRules = preparingNewAnchor
      ? [
          'Do not include any other character Approved Anchor or character image as a subject reference for this new-anchor request.',
          'Do not copy another character identity to compensate for the absence of an Approved Anchor.',
        ]
      : [];
    return [
      ...global,
      ...newAnchorRules,
      ...bulletsAfterLabel(styleMarkdown, '変更してはいけないもの'),
      ...common,
    ];
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
  const nextTopLevel = rest.search(/^##\s+/m);
  const end = nextTopLevel >= 0 ? nextTopLevel : rest.length;
  return rest.slice(0, end).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
