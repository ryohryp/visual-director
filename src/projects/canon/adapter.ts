import { bullets, bulletsAfterLabel, section, subsection } from '../../domain/markdown.js';
import { VisualDirectorError } from '../../domain/types.js';
import type { ApprovedAnchorSummary, GenerationPackage, PrepareGenerationInput } from '../../domain/types.js';
import { LocalRepositorySource } from '../repository-source.js';
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
  mode?: 'approved_anchor';
}

export class CanonProjectAdapter extends CanonAdapterBase {
  private readonly definition: CanonProjectDefinition;
  private readonly subjectAliases: Map<string, string>;

  constructor(definition: CanonProjectDefinition, options: CanonProjectAdapterOptions) {
    const source = options.source ?? (options.repoPath ? new LocalRepositorySource(options.repoPath) : undefined);
    if (!source) {
      throw new VisualDirectorError('PROJECT_CONFIG_MISSING', `No repository source is configured for project_id: ${definition.projectId}.`);
    }
    super({
      projectId: definition.projectId,
      source,
      documents: definition.documents,
      labels: definition.labels,
      subjectIds: Object.keys(definition.subjects),
    });
    this.definition = definition;
    this.subjectAliases = buildSubjectAliasIndex(definition.subjects);
  }

  override async prepare(input: PrepareGenerationInput): Promise<GenerationPackage> {
    return super.prepare({
      ...input,
      subject_ids: input.subject_ids.map((subjectId) => this.resolveSubjectId(subjectId)),
    });
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
    await this.source.ensureFile(anchorPath, `Approved Anchor for ${subjectId}`);
    const characterMarkdown = await this.source.readText(configured.characterFile, `Character facts for ${subjectId}`);
    return { ...configured, anchorPath, canonSection, characterMarkdown, mode: 'approved_anchor' };
  }

  protected async listApprovedAnchors(canonMarkdown: string): Promise<ApprovedAnchorSummary[]> {
    const anchors: ApprovedAnchorSummary[] = [];
    for (const configured of Object.values(this.definition.subjects)) {
      const canonSection = section(canonMarkdown, configured.canonHeading);
      const anchorPath = approvedAnchorPaths(subsection(canonSection, 'Approved Visual Anchor'))[0];
      if (!anchorPath) continue;
      await this.source.ensureFile(anchorPath, `Approved Anchor for ${configured.id}`);
      anchors.push({
        subject_id: configured.id,
        display_name: configured.displayName,
        asset_type: 'character_visual_anchor',
        path: anchorPath,
        status: 'approved',
      });
    }
    return anchors;
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

  private resolveSubjectId(value: string): string {
    const normalized = normalizeSubjectAlias(value);
    return this.subjectAliases.get(normalized) ?? value.trim();
  }
}

function buildSubjectAliasIndex(subjects: Record<string, ProjectSubjectDefinition>): Map<string, string> {
  const index = new Map<string, string>();
  for (const subject of Object.values(subjects)) {
    for (const alias of [subject.id, subject.displayName, ...(subject.aliases ?? [])]) {
      const key = normalizeSubjectAlias(alias);
      const existing = index.get(key);
      if (existing && existing !== subject.id) {
        throw new VisualDirectorError('PROJECT_CONFIG_INVALID', `Subject alias ${alias} is ambiguous between ${existing} and ${subject.id}.`);
      }
      index.set(key, subject.id);
    }
  }
  return index;
}

function normalizeSubjectAlias(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/g, '');
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
