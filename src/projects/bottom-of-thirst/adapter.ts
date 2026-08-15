import { bullets, bulletsAfterLabel, section, subsection, tableFacts } from '../../domain/markdown.js';
import { VisualDirectorError } from '../../domain/types.js';
import type { GenerationPackage, PrepareGenerationInput } from '../../domain/types.js';
import { LocalRepositorySource } from '../repository-source.js';
import type { RepositorySource } from '../repository-source.js';
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
  aliases?: string[];
  requiredNewAnchorTerms?: string[];
}

const SUBJECTS: Record<string, SubjectConfig> = {
  souma: {
    id: 'souma',
    displayName: '相馬 健人',
    characterFile: 'docs/characters/soma.md',
    canonHeading: '相馬 健人',
    aliases: ['相馬', '相馬健人'],
  },
  saya: {
    id: 'saya',
    displayName: '水上 沙耶',
    characterFile: 'docs/characters/saya.md',
    canonHeading: '水上 沙耶',
    aliases: ['水上沙耶', '沙耶'],
  },
  hikawa_ruka: {
    id: 'hikawa_ruka',
    displayName: '氷川 瑠花',
    characterFile: 'docs/characters/hikawa.md',
    canonHeading: '氷川 瑠花',
    aliases: ['氷川瑠花', '瑠花'],
  },
  kagami: {
    id: 'kagami',
    displayName: '鏡 玲央',
    characterFile: 'docs/characters/kagami.md',
    canonHeading: '鏡 玲央',
    aliases: ['鏡玲央', '玲央'],
  },
  kitou: {
    id: 'kitou',
    displayName: '鬼頭 厳山',
    characterFile: 'docs/characters/kito.md',
    canonHeading: '鬼頭 厳山',
    aliases: ['鬼頭厳山', '鬼頭'],
  },
  mikoshiba: {
    id: 'mikoshiba',
    displayName: '御子柴 徹',
    characterFile: 'docs/characters/mikoshiba.md',
    canonHeading: '御子柴 徹',
    anchorRequirementsFile: 'docs/visual/MIKOSHIBA_VISUAL_ANCHOR_V2_REQUIREMENTS.md',
    aliases: ['御子柴徹', '御子柴'],
    requiredNewAnchorTerms: ['25歳', '刑事'],
  },
  kamino_kyosuke: {
    id: 'kamino_kyosuke',
    displayName: '神野 恭介',
    characterFile: 'docs/characters/kyosuke.md',
    canonHeading: '神野 恭介',
    anchorRequirementsFile: 'docs/visual/KYOSUKE_VISUAL_ANCHOR_V2_REQUIREMENTS.md',
    aliases: ['神野恭介', '神野', '恭介', 'Kamino Kyosuke', 'Kyosuke Kamino'],
    requiredNewAnchorTerms: ['24歳', '動画配信者', 'ジンバル'],
  },
};

const SUBJECT_ALIAS_INDEX = buildSubjectAliasIndex();

export interface BottomOfThirstAdapterOptions {
  repoPath?: string;
  source?: RepositorySource;
}

export class BottomOfThirstAdapter extends CanonAdapterBase {
  constructor(options: BottomOfThirstAdapterOptions) {
    const source = options.source ?? (options.repoPath ? new LocalRepositorySource(options.repoPath) : undefined);
    if (!source) {
      throw new VisualDirectorError('PROJECT_CONFIG_MISSING', `No repository source is configured for project_id: ${PROJECT_ID}.`);
    }
    super({
      projectId: PROJECT_ID,
      source,
      documents: DEFAULT_PROJECT_DOCUMENTS,
      labels: DEFAULT_PROJECT_LABELS,
      subjectIds: configuredSubjects(),
    });
  }

  override async prepare(input: PrepareGenerationInput): Promise<GenerationPackage> {
    return super.prepare(normalizeBottomOfThirstInput(input));
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

  protected async loadSubject(subjectId: string, canonMarkdown: string, assetType = ''): Promise<SubjectAnchor> {
    const configured = SUBJECTS[subjectId];
    if (!configured) {
      throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${subjectId}.`);
    }

    const characterMarkdown = await this.source.readText(configured.characterFile, `Character facts for ${subjectId}`);
    const canonSection = section(canonMarkdown, configured.canonHeading);
    const anchorSection = canonSection ? subsection(canonSection, 'Approved Visual Anchor') : '';
    const anchorPaths = approvedAnchorPaths(anchorSection);
    const anchorPath = anchorPaths[0];
    const anchorFallback = anchorPaths[1];

    if (anchorPath) {
      await this.source.ensureFile(anchorPath, `Approved Anchor for ${subjectId}`);
      if (anchorFallback && !(await this.source.fileExists(anchorFallback))) {
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

    const requirementsMarkdown = await this.source.readText(
      configured.anchorRequirementsFile,
      `Visual Anchor requirements for ${subjectId}`,
    );
    if (!requirementsMarkdown.trim()) {
      throw new VisualDirectorError('NEW_ANCHOR_REQUIREMENTS_EMPTY', `Visual Anchor requirements are empty for ${subjectId}.`, {
        subject_id: subjectId,
        path: configured.anchorRequirementsFile,
      });
    }
    validateRequiredNewAnchorTerms(configured, characterMarkdown, requirementsMarkdown);

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
      const facts = canonicalFacts(subject.characterMarkdown, 16);
      if (facts.length === 0) {
        throw new VisualDirectorError('NEW_ANCHOR_CANON_INCOMPLETE', `No structured character facts were found for ${subject.id}.`, {
          subject_id: subject.id,
        });
      }
      return [
        `${subject.displayName} (${subject.id}) — NEW VISUAL ANCHOR CANDIDATE.`,
        'No Approved Visual Anchor exists for this subject. Do not use, imitate, merge, or borrow the face, hair, body, clothing, pose, props, or silhouette of any other character as an identity reference.',
        `Canonical character facts: ${facts.join(' | ')}`,
        'AUTHORITATIVE NEW-ANCHOR REQUIREMENTS:',
        subject.requirementsMarkdown?.trim() ?? '',
      ].join('\n\n');
    }

    const accepted = bullets(subsection(subject.canonSection, '採用する視覚条件'));
    const canonicalState = subsection(subject.canonSection, 'Canonical state model');
    const facts = canonicalFacts(subject.characterMarkdown, 8);
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

  protected forbiddenChanges(canonMarkdown: string, styleMarkdown: string, preparingNewAnchor = false): string[] {
    const common = bullets(section(canonMarkdown, '共通ルール'));
    const newAnchorRules = preparingNewAnchor
      ? [
          'Do not include any other character Approved Anchor or character image as a subject reference for this new-anchor request.',
          'Do not copy another character identity to compensate for the absence of an Approved Anchor.',
          'Do not generate from assistant memory, conversation guesses, or hand-written fallback character facts when Canon preparation fails.',
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

export function normalizeBottomOfThirstInput(input: PrepareGenerationInput): PrepareGenerationInput {
  return {
    ...input,
    asset_type: normalizeAssetType(input.asset_type),
    subject_ids: input.subject_ids.map((subjectId) => normalizeSubjectId(subjectId)),
  };
}

function normalizeAssetType(assetType: string): string {
  const normalized = assetType
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'visual_anchor' || normalized === 'character_anchor' || normalized === 'visualanchor') {
    return NEW_ANCHOR_ASSET_TYPE;
  }
  return assetType.trim();
}

function normalizeSubjectId(subjectId: string): string {
  const canonical = SUBJECT_ALIAS_INDEX.get(normalizeAlias(subjectId));
  return canonical ?? subjectId.trim();
}

export function bottomOfThirstCanonSubject(subjectId: string): { id: string; canonHeading: string } | undefined {
  const id = normalizeSubjectId(subjectId);
  const subject = SUBJECTS[id];
  return subject ? { id, canonHeading: subject.canonHeading } : undefined;
}

function buildSubjectAliasIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const subject of Object.values(SUBJECTS)) {
    const aliases = [subject.id, subject.displayName, subject.displayName.replace(/\s+/g, ''), ...(subject.aliases ?? [])];
    for (const alias of aliases) {
      const key = normalizeAlias(alias);
      const existing = index.get(key);
      if (existing && existing !== subject.id) {
        throw new Error(`Ambiguous Bottom of Thirst subject alias: ${alias}`);
      }
      index.set(key, subject.id);
    }
  }
  return index;
}

function normalizeAlias(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function canonicalFacts(markdown: string, limit: number): string[] {
  return [...new Set([...tableFacts(markdown), ...bullets(markdown)])].slice(0, limit);
}

function validateRequiredNewAnchorTerms(
  configured: SubjectConfig,
  characterMarkdown: string,
  requirementsMarkdown: string,
): void {
  const requiredTerms = configured.requiredNewAnchorTerms ?? [];
  if (requiredTerms.length === 0) return;
  const source = `${characterMarkdown}\n${requirementsMarkdown}`;
  const missingTerms = requiredTerms.filter((term) => !source.includes(term));
  if (missingTerms.length > 0) {
    throw new VisualDirectorError(
      'NEW_ANCHOR_CANON_INCOMPLETE',
      `Critical new-anchor Canon facts are missing for ${configured.id}.`,
      { subject_id: configured.id, missing_terms: missingTerms },
    );
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
