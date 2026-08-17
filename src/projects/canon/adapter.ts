import { bullets, bulletsAfterLabel, section, subsection, tableFacts } from '../../domain/markdown.js';
import { VisualDirectorError } from '../../domain/types.js';
import type { ApprovedAnchorSummary, GenerationPackage, PrepareGenerationInput } from '../../domain/types.js';
import { LocalRepositorySource } from '../repository-source.js';
import { CanonAdapterBase, globalForbiddenChanges } from './adapter-base.js';
import { parseGrandDesign, resolveGrandDesignContract } from './grand-design.js';
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
  id: string;
  displayName: string;
  anchorPath?: string;
  anchorFallback?: string;
  canonSection: string;
  characterMarkdown: string;
  requirementsMarkdown?: string;
  mode?: 'approved_anchor' | 'new_anchor_candidate';
}

const NEW_ANCHOR_ASSET_TYPE = 'character_visual_anchor';

export class CanonProjectAdapter extends CanonAdapterBase {
  private readonly definition: CanonProjectDefinition;
  private readonly subjectAliases: Map<string, string>;

  constructor(definition: CanonProjectDefinition, options: CanonProjectAdapterOptions) {
    const source = options.source ?? (options.repoPath ? new LocalRepositorySource(options.repoPath) : undefined);
    if (!source) throw new VisualDirectorError('PROJECT_CONFIG_MISSING', `No repository source is configured for project_id: ${definition.projectId}.`);
    super({ projectId: definition.projectId, source, documents: definition.documents, labels: definition.labels, subjectIds: Object.keys(definition.subjects) });
    this.definition = definition;
    this.subjectAliases = buildSubjectAliasIndex(definition.subjects);
  }

  override async prepare(input: PrepareGenerationInput): Promise<GenerationPackage> {
    const normalizedInput = { ...input, asset_type: normalizeAssetType(input.asset_type), subject_ids: input.subject_ids.map((subjectId) => this.resolveSubjectId(subjectId)) };
    const prepared = await super.prepare(normalizedInput);
    const grandDesignPath = this.definition.documents.grandDesign;
    if (!grandDesignPath) return prepared;
    const raw = await this.source.readText(grandDesignPath, 'Grand Design');
    const grandDesign = parseGrandDesign(raw, this.projectId, grandDesignPath);
    const contract = resolveGrandDesignContract(grandDesign, normalizedInput.asset_type);
    const promptPackage = { ...prepared.prompt_package };
    delete promptPackage.grand_design_lock;
    return { ...prepared, prompt_package: { ...promptPackage, ...(contract ? { grand_design_contract: contract } : {}) } };
  }

  protected async loadSubject(subjectId: string, canonMarkdown: string, assetType = ''): Promise<SubjectAnchor> {
    const configured = this.definition.subjects[subjectId];
    if (!configured) throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${subjectId}.`);
    const canonSection = section(canonMarkdown, configured.canonHeading);
    const anchorPaths = approvedAnchorPaths(subsection(canonSection, 'Approved Visual Anchor'));
    const anchorPath = anchorPaths[0];
    const anchorFallback = anchorPaths[1];
    const characterMarkdown = await this.source.readText(configured.characterFile, `Character facts for ${subjectId}`);
    if (anchorPath) {
      await this.source.ensureFile(anchorPath, `Approved Anchor for ${subjectId}`);
      if (anchorFallback && !(await this.source.fileExists(anchorFallback))) throw new VisualDirectorError('APPROVED_ANCHOR_INCOMPLETE', `Same-generation fallback is missing for ${subjectId}.`, { subject_id: subjectId, path: anchorFallback });
      return { ...configured, anchorPath, anchorFallback, canonSection, characterMarkdown, mode: 'approved_anchor' };
    }
    if (assetType !== NEW_ANCHOR_ASSET_TYPE) throw new VisualDirectorError('APPROVED_ANCHOR_NOT_FOUND', `Approved Anchor is not defined for ${subjectId}.`, { subject_id: subjectId, required_asset_type_for_new_anchor: NEW_ANCHOR_ASSET_TYPE });
    if (!configured.anchorRequirementsFile) throw new VisualDirectorError('NEW_ANCHOR_REQUIREMENTS_NOT_CONFIGURED', `New Visual Anchor requirements are not configured for ${subjectId}.`, { subject_id: subjectId });
    const requirementsMarkdown = await this.source.readText(configured.anchorRequirementsFile, `Visual Anchor requirements for ${subjectId}`);
    if (!requirementsMarkdown.trim()) throw new VisualDirectorError('NEW_ANCHOR_REQUIREMENTS_EMPTY', `Visual Anchor requirements are empty for ${subjectId}.`, { subject_id: subjectId, path: configured.anchorRequirementsFile });
    validateRequiredNewAnchorTerms(configured, characterMarkdown, requirementsMarkdown);
    return { ...configured, canonSection, characterMarkdown, requirementsMarkdown, mode: 'new_anchor_candidate' };
  }

  protected async listApprovedAnchors(canonMarkdown: string): Promise<ApprovedAnchorSummary[]> {
    const anchors: ApprovedAnchorSummary[] = [];
    for (const configured of Object.values(this.definition.subjects)) {
      const canonSection = section(canonMarkdown, configured.canonHeading);
      const anchorPath = approvedAnchorPaths(subsection(canonSection, 'Approved Visual Anchor'))[0];
      if (!anchorPath) continue;
      await this.source.ensureFile(anchorPath, `Approved Anchor for ${configured.id}`);
      anchors.push({ subject_id: configured.id, display_name: configured.displayName, asset_type: NEW_ANCHOR_ASSET_TYPE, path: anchorPath, status: 'approved' });
    }
    return anchors;
  }

  protected subjectLock(subject: SubjectAnchor): string {
    if (subject.mode === 'new_anchor_candidate') {
      const facts = canonicalFacts(subject.characterMarkdown, 16);
      if (facts.length === 0) throw new VisualDirectorError('NEW_ANCHOR_CANON_INCOMPLETE', `No structured character facts were found for ${subject.id}.`, { subject_id: subject.id });
      return [`${subject.displayName} (${subject.id}) — NEW VISUAL ANCHOR CANDIDATE.`, 'No Approved Visual Anchor exists for this subject. Do not use, imitate, merge, or borrow the identity of another character as a reference.', `Canonical character facts: ${facts.join(' | ')}`, 'AUTHORITATIVE NEW-ANCHOR REQUIREMENTS:', subject.requirementsMarkdown?.trim() ?? ''].join('\n\n');
    }
    const accepted = bullets(subsection(subject.canonSection, this.labels.acceptedConditionsHeading));
    const canonicalState = subsection(subject.canonSection, 'Canonical state model');
    const facts = canonicalFacts(subject.characterMarkdown, 8);
    return `${subject.displayName} (${subject.id}) - Approved Visual Anchor: ${subject.anchorPath}. ${accepted.join(' ')} ${facts.join(' ')}${canonicalState ? ` Canonical state: ${canonicalState}` : ''}`.trim();
  }

  protected allowedChanges(styleMarkdown: string, preparingNewAnchor = false): string[] {
    if (preparingNewAnchor) return ['Create the initial identity and default silhouette for this subject only.', 'Choose face, hair, body proportions, clothing details, pose, and subject props only within the authoritative character and Visual Anchor requirements.'];
    return bulletsAfterLabel(styleMarkdown, this.labels.allowedChangesHeading);
  }

  protected forbiddenChanges(canonMarkdown: string, styleMarkdown: string, preparingNewAnchor = false): string[] {
    return [...globalForbiddenChanges(), ...(preparingNewAnchor ? ['Do not include any other character Approved Anchor or character image as a subject reference for this new-anchor request.', 'Do not copy another character identity to compensate for the absence of an Approved Anchor.', 'Do not generate from assistant memory, conversation guesses, or fallback character facts when Canon preparation fails.'] : []), ...bulletsAfterLabel(styleMarkdown, this.labels.forbiddenChangesHeading), ...bullets(section(canonMarkdown, this.labels.commonRulesHeading))];
  }

  private resolveSubjectId(value: string): string { return this.subjectAliases.get(normalizeSubjectAlias(value)) ?? value.trim(); }
}

function buildSubjectAliasIndex(subjects: Record<string, ProjectSubjectDefinition>): Map<string, string> {
  const index = new Map<string, string>();
  for (const subject of Object.values(subjects)) for (const alias of [subject.id, subject.displayName, ...(subject.aliases ?? [])]) { const key = normalizeSubjectAlias(alias); const existing = index.get(key); if (existing && existing !== subject.id) throw new VisualDirectorError('PROJECT_CONFIG_INVALID', `Subject alias ${alias} is ambiguous between ${existing} and ${subject.id}.`); index.set(key, subject.id); }
  return index;
}
function normalizeSubjectAlias(value: string): string { return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/g, ''); }
function normalizeAssetType(value: string): string { const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/[\s-]+/g, '_'); if (normalized === 'visual_anchor' || normalized === 'character_anchor' || normalized === 'visualanchor') return NEW_ANCHOR_ASSET_TYPE; return value.trim(); }
function canonicalFacts(markdown: string, limit: number): string[] { return [...new Set([...tableFacts(markdown), ...bullets(markdown)])].slice(0, limit); }
function validateRequiredNewAnchorTerms(configured: ProjectSubjectDefinition, characterMarkdown: string, requirementsMarkdown: string): void { const requiredTerms = configured.requiredNewAnchorTerms ?? []; const source = `${characterMarkdown}\n${requirementsMarkdown}`; const missingTerms = requiredTerms.filter((term) => !source.includes(term)); if (missingTerms.length > 0) throw new VisualDirectorError('NEW_ANCHOR_CANON_INCOMPLETE', `Critical new-anchor Canon facts are missing for ${configured.id}.`, { subject_id: configured.id, missing_terms: missingTerms }); }
export function approvedAnchorPaths(anchorSection: string): string[] { const paths: string[] = []; for (const line of anchorSection.split(/\r?\n/)) { const match = line.match(/^\s*-\s+`([^`]+)`\s*$/); if (match?.[1]) { paths.push(match[1]); continue; } if (line.trim() !== '') break; } return paths; }
