import { bullets, bulletsAfterLabel, readUtf8File, section, subsection } from '../../domain/markdown.js';
import { VisualDirectorError } from '../../domain/types.js';
import type { PrepareGenerationInput } from '../../domain/types.js';
import { CanonAdapterBase, globalForbiddenChanges } from '../canon/adapter-base.js';
import { DEFAULT_PROJECT_DOCUMENTS, DEFAULT_PROJECT_LABELS } from '../canon/types.js';
import type { CanonSubject } from '../canon/adapter-base.js';

const PROJECT_ID = 'bottom-of-thirst';
const NEW_ANCHOR_ASSET_TYPE = 'character_visual_anchor';

interface SubjectAnchor extends CanonSubject {
  anchorRequirementsFile?: string;
  anchorFallback?: string;
  requirementsMarkdown?: string;
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

export class BottomOfThirstAdapter extends CanonAdapterBase {
  constructor(options: BottomOfThirstAdapterOptions) {
    super({
      projectId: PROJECT_ID,
      repoPath: options.repoPath,
      documents: DEFAULT_PROJECT_DOCUMENTS,
      labels: DEFAULT_PROJECT_LABELS,
      subjectIds: configuredSubjects(),
    });
  }

  protected validateTextInput(input: PrepareGenerationInput): void {
    if (!input.asset_type.trim()) {
      throw new VisualDirectorError('INVALID_INPUT', 'asset_type must not be empty.');
    }
    if (!input.request_text.trim()) {
      throw new VisualDirectorError('INVALID_INPUT', 'request_text must not be empty.');
    }
  }

  protected globalStyleIncompleteMessage(): string {
    return 'Global Visual Style is missing the required Global Visual Style Lock or Fixed Avoid Block.';
  }

  protected async loadSubject(
    subjectId: string,
    canonMarkdown: string,
    assetType = '',
  ): Promise<SubjectAnchor> {
    const configured = SUBJECTS[subjectId];
    if (!configured) {
      throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${subjectId}.`);
    }

    const characterMarkdown = await readUtf8File(
      this.resolvePath(configured.characterFile),
      `Character facts for ${subjectId}`,
    );
    const canonSection = characterSection(canonMarkdown, configured.canonHeading);
    const anchorSection = canonSection ? subsection(canonSection, 'Approved Visual Anchor') : '';
    const anchorPaths = approvedAnchorPaths(anchorSection);
    const anchorPath = anchorPaths[0];
    const anchorFallback = anchorPaths[1];

    if (anchorPath) {
      await this.ensureFile(this.resolvePath(anchorPath), `Approved Anchor for ${subjectId}`);
      if (anchorFallback && !(await this.fileExists(this.resolvePath(anchorFallback)))) {
        throw new VisualDirectorError('APPROVED_ANCHOR_INCOMPLETE', `Same-generation fallback is missing for ${subjectId}.`, {
          subject_id: subjectId,
          path: anchorFallback,
        });
      }
      return { ...configured, anchorPath, anchorFallback, canonSection, characterMarkdown, mode: 'approved_anchor' };
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
      this.resolvePath(configured.anchorRequirementsFile),
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

  protected subjectLock(subject: SubjectAnchor): string {
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

  protected allowedChanges(styleMarkdown: string, preparingNewAnchor = false): string[] {
    if (preparingNewAnchor) {
      return [
        'Create the initial identity and default silhouette for this subject only.',
        'Choose face, hair, body proportions, clothing details, pose, and subject props only within the authoritative character and Visual Anchor requirements.',
      ];
    }
    return bulletsAfterLabel(styleMarkdown, '変更してよいもの');
  }

  protected forbiddenChanges(
    canonMarkdown: string,
    styleMarkdown: string,
    preparingNewAnchor = false,
  ): string[] {
    const common = bullets(section(canonMarkdown, '共通ルール'));
    const newAnchorRules = preparingNewAnchor
      ? [
          'Do not include any other character Approved Anchor or character image as a subject reference for this new-anchor request.',
          'Do not copy another character identity to compensate for the absence of an Approved Anchor.',
        ]
      : [];
    return [
      ...globalForbiddenChanges(),
      ...newAnchorRules,
      ...bulletsAfterLabel(styleMarkdown, '変更してはいけないもの'),
      ...common,
    ];
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
  const nextCharacter = rest.search(/^##\\s+(?:水上 沙耶|相馬 健人|氷川 瑠花|鏡 玲央|鬼頭 厳山|御子柴 徹|神野 恭介)\\s*$/m);
  const nextTopLevel = rest.search(/^##\\s+/m);
  const boundaries = [nextCharacter, nextTopLevel].filter((index) => index >= 0);
  const end = boundaries.length > 0 ? Math.min(...boundaries) : rest.length;
  return rest.slice(0, end).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
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
