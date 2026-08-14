import { bullets, bulletsAfterLabel, readUtf8File, section, subsection } from '../../domain/markdown.js';
import { VisualDirectorError } from '../../domain/types.js';
import { CanonAdapterBase, globalForbiddenChanges } from './adapter-base.js';
import type { CanonProjectDefinition, CanonProjectAdapterOptions, ProjectSubjectDefinition } from './types.js';

export type {
  CanonProjectAdapterOptions,
  CanonProjectDefinition,
  ProjectDocuments,
  ProjectLabels,
  ProjectSubjectDefinition,
} from './types.js';
export { DEFAULT_PROJECT_DOCUMENTS, DEFAULT_PROJECT_LABELS } from './types.js';

interface SubjectAnchor extends ProjectSubjectDefinition {
  anchorPath: string;
  canonSection: string;
  characterMarkdown: string;
}

export class CanonProjectAdapter extends CanonAdapterBase {
  private readonly definition: CanonProjectDefinition;

  constructor(definition: CanonProjectDefinition, options: CanonProjectAdapterOptions) {
    super({
      projectId: definition.projectId,
      repoPath: options.repoPath,
      documents: definition.documents,
      labels: definition.labels,
      subjectIds: Object.keys(definition.subjects),
    });
    this.definition = definition;
  }

  protected async loadSubject(subjectId: string, canonMarkdown: string): Promise<SubjectAnchor> {
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
    await this.ensureFile(this.resolvePath(anchorPath), `Approved Anchor for ${subjectId}`);
    const characterMarkdown = await readUtf8File(
      this.resolvePath(configured.characterFile),
      `Character facts for ${subjectId}`,
    );
    return { ...configured, anchorPath, canonSection, characterMarkdown };
  }

  protected subjectLock(subject: SubjectAnchor): string {
    const accepted = bullets(subsection(subject.canonSection, this.labels.acceptedConditionsHeading));
    const canonicalState = subsection(subject.canonSection, 'Canonical state model');
    const facts = bullets(subject.characterMarkdown).slice(0, 8);
    return `${subject.displayName} (${subject.id}) - Approved Visual Anchor: ${subject.anchorPath}. ${accepted.join(' ')} ${facts.join(' ')}${canonicalState ? ` Canonical state: ${canonicalState}` : ''}`.trim();
  }

  protected allowedChanges(styleMarkdown: string): string[] {
    return bulletsAfterLabel(styleMarkdown, this.labels.allowedChangesHeading);
  }

  protected forbiddenChanges(canonMarkdown: string, styleMarkdown: string): string[] {
    return [
      ...globalForbiddenChanges(),
      ...bulletsAfterLabel(styleMarkdown, this.labels.forbiddenChangesHeading),
      ...bullets(section(canonMarkdown, this.labels.commonRulesHeading)),
    ];
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
