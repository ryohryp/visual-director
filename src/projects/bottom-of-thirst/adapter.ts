import { bullets, bulletsAfterLabel, readUtf8File, section, subsection } from '../../domain/markdown.js';
import { VisualDirectorError } from '../../domain/types.js';
import type { PrepareGenerationInput } from '../../domain/types.js';
import { CanonAdapterBase, globalForbiddenChanges } from '../canon/adapter-base.js';
import { DEFAULT_PROJECT_DOCUMENTS, DEFAULT_PROJECT_LABELS } from '../canon/types.js';

const PROJECT_ID = 'bottom-of-thirst';

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

  protected async loadSubject(subjectId: string, canonMarkdown: string): Promise<SubjectAnchor> {
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
    const anchorPaths = approvedAnchorPaths(anchorSection);
    const anchorPath = anchorPaths[0];
    const anchorFallback = anchorPaths[1];
    if (!anchorPath) {
      throw new VisualDirectorError('APPROVED_ANCHOR_NOT_FOUND', `Approved Anchor path is missing for ${subjectId}.`, {
        subject_id: subjectId,
      });
    }
    await this.ensureFile(this.resolvePath(anchorPath), `Approved Anchor for ${subjectId}`);
    if (anchorFallback && !(await this.fileExists(this.resolvePath(anchorFallback)))) {
      throw new VisualDirectorError('APPROVED_ANCHOR_INCOMPLETE', `Same-generation fallback is missing for ${subjectId}.`, {
        subject_id: subjectId,
        path: anchorFallback,
      });
    }
    const characterMarkdown = await readUtf8File(
      this.resolvePath(configured.characterFile),
      `Character facts for ${subjectId}`,
    );
    return { ...configured, anchorPath, anchorFallback, canonSection, characterMarkdown };
  }

  protected subjectLock(subject: SubjectAnchor): string {
    const accepted = bullets(subsection(subject.canonSection, '採用する視覚条件'));
    const canonicalState = subsection(subject.canonSection, 'Canonical state model');
    const facts = bullets(subject.characterMarkdown).slice(0, 8);
    const state = canonicalState ? ` Canonical state: ${canonicalState}` : '';
    return `${subject.displayName} (${subject.id}) — Approved Visual Anchor: ${subject.anchorPath}. ${accepted.join(' ')} ${facts.join(' ')}${state}`.trim();
  }

  protected allowedChanges(styleMarkdown: string): string[] {
    return bulletsAfterLabel(styleMarkdown, '変更してよいもの');
  }

  protected forbiddenChanges(canonMarkdown: string, styleMarkdown: string): string[] {
    const common = bullets(section(canonMarkdown, '共通ルール'));
    return [...globalForbiddenChanges(), ...bulletsAfterLabel(styleMarkdown, '変更してはいけないもの'), ...common];
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
