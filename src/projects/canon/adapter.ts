import { bullets, bulletsAfterLabel, section, subsection, tableFacts } from '../../domain/markdown.js';
import { VisualDirectorError } from '../../domain/types.js';
import type { ApprovedAnchorSummary, GenerationPackage, PrepareGenerationInput } from '../../domain/types.js';
import { LocalRepositorySource } from '../repository-source.js';
import { CanonAdapterBase, globalForbiddenChanges } from './adapter-base.js';
import { parseGrandDesign, resolveGrandDesignContract } from './grand-design.js';
import type { GrandDesignContract, GrandDesignDocument } from './grand-design.js';
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
const INTERNAL_SCENE_CONTEXT_KEYS = new Set(['repository_path', 'reference_paths']);

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
    const normalizedInput = {
      ...input,
      asset_type: normalizeAssetType(input.asset_type),
      subject_ids: input.subject_ids.map((subjectId) => this.resolveSubjectId(subjectId)),
    };
    if (normalizedInput.subject_ids.length === 0) return this.prepareNonCharacterAsset(normalizedInput);

    const prepared = await super.prepare(normalizedInput);
    const grandDesignPath = this.definition.documents.grandDesign;
    if (!grandDesignPath) return prepared;
    const raw = await this.source.readText(grandDesignPath, 'Grand Design');
    const grandDesign = parseGrandDesign(raw, this.projectId, grandDesignPath);
    const contract = resolveGrandDesignContract(grandDesign, normalizedInput.asset_type);
    if (!contract && prepared.policy.must_use_approved_anchor) return prepared;
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
    if (!requirementsMarkdown.trim()) throw new VisualDirectorError('NEW_ANCHOR_REQUIREMENTS_EMPTY', `New Visual Anchor requirements are empty for ${subjectId}.`, { subject_id: subjectId, path: configured.anchorRequirementsFile });
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

  private async prepareNonCharacterAsset(input: PrepareGenerationInput): Promise<GenerationPackage> {
    if (input.project_id !== this.projectId) throw new VisualDirectorError('PROJECT_NOT_FOUND', `Unsupported project_id: ${input.project_id}.`);
    if (!input.asset_type.trim() || !input.request_text.trim()) throw new VisualDirectorError('INVALID_INPUT', 'asset_type and request_text must not be empty.');
    if (input.asset_type === NEW_ANCHOR_ASSET_TYPE) {
      throw new VisualDirectorError('INVALID_INPUT', 'character_visual_anchor requires exactly one character subject_id.');
    }

    const grandDesignPath = this.definition.documents.grandDesign;
    if (!grandDesignPath) {
      throw new VisualDirectorError('GRAND_DESIGN_REQUIRED', 'Subjectless asset preparation requires a repository Grand Design contract.', {
        asset_type: input.asset_type,
      });
    }
    const raw = await this.source.readText(grandDesignPath, 'Grand Design');
    const grandDesign = parseGrandDesign(raw, this.projectId, grandDesignPath);
    const contract = resolveGrandDesignContract(grandDesign, input.asset_type);
    if (!contract) {
      throw new VisualDirectorError('GRAND_DESIGN_ASSET_TYPE_UNSUPPORTED', 'Subjectless preparation is only allowed for asset types explicitly defined by Grand Design.', {
        asset_type: input.asset_type,
      });
    }

    const sourceReferenceRequired = contract.asset_contract.source_reference_required !== false;
    const referencePaths = explicitReferencePaths(input, sourceReferenceRequired);
    for (const referencePath of referencePaths) {
      if (referencePath.startsWith('.visual-director/')) {
        throw new VisualDirectorError('REFERENCE_OUTSIDE_PRODUCTION', 'Non-character source references must be production/reference assets, not Visual Director candidates or workflow files.', {
          path: referencePath,
        });
      }
      await this.source.ensureFile(referencePath, `Source asset reference for ${input.asset_type}`);
    }
    await this.source.ensureFile(this.definition.documents.globalReference, 'Global Visual Reference');

    const worldMarkdown = await this.source.readText(this.definition.documents.worldDirection, 'World Direction');
    const sceneContext = visibleSceneContext(input.scene_context);
    const contractForbidden = stringArray(contract.asset_contract.forbidden);
    const hasSourceReference = referencePaths.length > 0;

    return {
      project_id: this.projectId,
      asset_type: input.asset_type,
      prompt_package: {
        grand_design_contract: contract,
        style_lock: nonCharacterStyleLock(grandDesign, contract),
        subject_lock: [],
        scene_requirements: [
          `Asset type: ${input.asset_type}.`,
          `Narrative request: ${input.request_text.trim()}`,
          ...Object.entries(sceneContext).map(([key, value]) => `Scene context: ${key}: ${formatSceneValue(value)}`),
          ...bullets(worldMarkdown).slice(0, 8).map((rule) => `World direction: ${rule}`),
        ],
        allowed_changes: hasSourceReference
          ? [
            'Change only the physical, factual, compositional, lighting, wetness, dryness, damage, or evidence details explicitly required by this request and its Grand Design asset contract.',
            'Preserve the referenced asset location or object identity, stable camera logic, material language, and recognizable memory anchors unless the request explicitly requires a change.',
          ]
          : [
            'Create a new subjectless visual asset only within the factual, compositional, material, lighting, and style boundaries defined by this request and its Grand Design asset contract.',
            'Use the Global Visual Reference as the visual-family calibration source; do not borrow location identity, composition, or objects from unrelated generated or legacy assets.',
          ],
        forbidden_changes: unique([
          ...(hasSourceReference ? ['Do not redesign the referenced location or object into a different place merely for visual drama.'] : []),
          'Do not use a generated Candidate, superseded workflow asset, or unrelated legacy asset as an implicit generation parent.',
          'Do not invent people, objects, damage, water, blood, ritual props, symbols, weather, or supernatural evidence that are absent from the request and Canon.',
          ...contractForbidden,
        ]),
        avoid_block: unique([...grandDesign.fixed_avoid, ...contractForbidden]),
      },
      reference_assets: [
        { role: 'global_reference', path: this.definition.documents.globalReference },
        ...referencePaths.map((path) => ({ role: 'source_asset' as const, path })),
      ],
      policy: {
        must_use_approved_anchor: false,
        must_not_chain_from_candidate: true,
        must_review_after_generation: true,
      },
    };
  }

  private resolveSubjectId(value: string): string { return this.subjectAliases.get(normalizeSubjectAlias(value)) ?? value.trim(); }
}

function explicitReferencePaths(input: PrepareGenerationInput, required = true): string[] {
  const value = input.scene_context?.reference_paths;
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'string' && item.trim().length > 0)) {
    if (!required && (value === undefined || (Array.isArray(value) && value.length === 0))) return [];
    throw new VisualDirectorError('REFERENCE_REQUIRED', 'Subjectless Grand Design assets require scene_context.reference_paths with at least one repository-relative source asset path unless the asset contract explicitly sets source_reference_required to false.');
  }
  return unique(value.map((item) => (item as string).trim().replace(/\\/g, '/').replace(/^\.\//, '')));
}

function visibleSceneContext(sceneContext: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(sceneContext ?? {}).filter(([key]) => !INTERNAL_SCENE_CONTEXT_KEYS.has(key)));
}

function nonCharacterStyleLock(grandDesign: GrandDesignDocument, contract: GrandDesignContract): string {
  return [
    `VISUAL DNA: ${grandDesign.visual_dna}`,
    `SHARED RULES: ${stableJson(grandDesign.shared_rules)}`,
    `ASSET CONTRACT (${contract.asset_type}): ${stableJson(contract.asset_contract)}`,
  ].join('\n');
}

function formatSceneValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return stableJson(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : [];
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function buildSubjectAliasIndex(subjects: Record<string, ProjectSubjectDefinition>): Map<string, string> { const index = new Map<string, string>(); for (const subject of Object.values(subjects)) for (const alias of [subject.id, subject.displayName, ...(subject.aliases ?? [])]) { const key = normalizeSubjectAlias(alias); const existing = index.get(key); if (existing && existing !== subject.id) throw new VisualDirectorError('PROJECT_CONFIG_INVALID', `Subject alias ${alias} is ambiguous between ${existing} and ${subject.id}.`); index.set(key, subject.id); } return index; }
function normalizeSubjectAlias(value: string): string { return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/g, ''); }
function normalizeAssetType(value: string): string { const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/[\s-]+/g, '_'); if (normalized === 'visual_anchor' || normalized === 'character_anchor' || normalized === 'visualanchor') return NEW_ANCHOR_ASSET_TYPE; return value.trim(); }
function canonicalFacts(markdown: string, limit: number): string[] { return [...new Set([...tableFacts(markdown), ...bullets(markdown)])].slice(0, limit); }
function validateRequiredNewAnchorTerms(configured: ProjectSubjectDefinition, characterMarkdown: string, requirementsMarkdown: string): void { const requiredTerms = configured.requiredNewAnchorTerms ?? []; const source = `${characterMarkdown}\n${requirementsMarkdown}`; const missingTerms = requiredTerms.filter((term) => !source.includes(term)); if (missingTerms.length > 0) throw new VisualDirectorError('NEW_ANCHOR_CANON_INCOMPLETE', `Critical new-anchor Canon facts are missing for ${configured.id}.`, { subject_id: configured.id, missing_terms: missingTerms }); }
export function approvedAnchorPaths(anchorSection: string): string[] { const paths: string[] = []; for (const line of anchorSection.split(/\r?\n/)) { const match = line.match(/^\s*-\s+`([^`]+)`\s*$/); if (match?.[1]) { paths.push(match[1]); continue; } if (line.trim() !== '') break; } return paths; }
