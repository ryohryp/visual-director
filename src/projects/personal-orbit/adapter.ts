import { access } from 'node:fs/promises';
import path from 'node:path';

import { readUtf8File } from '../../domain/markdown.js';
import { VisualDirectorError } from '../../domain/types.js';
import type { GenerationPackage, PrepareGenerationInput, ProjectAdapter } from '../../domain/types.js';
import type { PersonalOrbitProjectDefinition } from './definition.js';

export interface PersonalOrbitAdapterOptions {
  repoPath: string;
}

export class PersonalOrbitAdapter implements ProjectAdapter {
  readonly projectId: string;
  private readonly definition: PersonalOrbitProjectDefinition;
  private readonly repoPath: string;

  constructor(definition: PersonalOrbitProjectDefinition, options: PersonalOrbitAdapterOptions) {
    this.projectId = definition.projectId;
    this.definition = definition;
    this.repoPath = path.resolve(options.repoPath);
  }

  async prepare(input: PrepareGenerationInput): Promise<GenerationPackage> {
    this.validateInput(input);

    const subjectId = input.subject_ids[0] as string;
    const subject = this.definition.subjects[subjectId];
    const approvedAnchor = this.definition.approvedAnchors[subjectId];
    if (!subject || !approvedAnchor) {
      throw new VisualDirectorError('APPROVED_ANCHOR_NOT_FOUND', `Approved Anchor is not registered for ${subjectId}.`, {
        subject_id: subjectId,
      });
    }

    const [townStyle, worldSource, orbySource, entrypoint] = await Promise.all([
      readUtf8File(this.resolvePath(this.definition.documents.globalStyle), 'Orby Town style source'),
      readUtf8File(this.resolvePath(this.definition.documents.worldDirection), 'Orby Town world source'),
      readUtf8File(this.resolvePath(this.definition.documents.characterCanon), 'Orby visual source'),
      readUtf8File(this.resolvePath(this.definition.documents.assetManifest), 'Orby Town entrypoint'),
    ]);
    if (!townStyle.trim() || !worldSource.trim() || !orbySource.trim() || !entrypoint.trim()) {
      throw new VisualDirectorError('CANON_READ_FAILED', 'Orby Town visual sources must not be empty.');
    }
    await this.ensureFile(this.resolvePath(approvedAnchor), `Approved Anchor for ${subjectId}`);

    const context = Object.entries(input.scene_context ?? {})
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ');

    return {
      project_id: this.projectId,
      asset_type: input.asset_type,
      prompt_package: {
        style_lock: [
          'ORBY TOWN STYLE LOCK',
          'Use the Approved Visual Anchor as the visual parent.',
          'Preserve the adopted practical, slightly near-future AI operations town: charcoal building exteriors, warm interior lighting, a clear central plaza and circulation paths, restrained greenery or water accents, readable facility signage, and compact agent scale.',
          'Keep the town itself visually distinct from the broader dark tactical dashboard shell; do not turn the scene into a panel-heavy cyber-noir dashboard.',
        ].join('\n'),
        subject_lock: [
          `${subject.displayName} (${subject.id}) - Approved Visual Anchor: ${approvedAnchor}.`,
          'Preserve the established facility layout, central plaza and circulation, miniature scale, and readable agent-to-facility relationship.',
        ],
        scene_requirements: [
          `Asset type: ${input.asset_type}.`,
          `Narrative request: ${input.request_text.trim()}`,
          ...(context ? [`Scene context: ${context}`] : []),
          `Town style source: ${this.definition.documents.globalStyle}.`,
          `Town world source: ${this.definition.documents.worldDirection}.`,
        ],
        allowed_changes: [
          'Agent positions and activity-specific props may vary while preserving facility identity and town circulation.',
          'Small ambient details, lighting nuance, and non-canonical decorative accents may vary when requested.',
          'Framing and crop may vary as long as the town remains immediately recognizable from the Approved Visual Anchor.',
        ],
        forbidden_changes: [
          'Do not replace the Approved Visual Anchor with a candidate, derivative, legacy, or unrelated image as the generation parent.',
          'Do not redesign the facility layout, central plaza and circulation, or miniature-world scale unless the request explicitly changes the canon.',
          'Do not replace the practical AI operations town with a fairy-tale village, medieval European town, photorealistic city, glossy sci-fi base, or full-screen tactical UI.',
          'Do not obscure the town with dense dashboard cards or text-heavy overlays.',
        ],
        avoid_block: [
          'fairy-tale village',
          'medieval European town',
          'pastel miniature village',
          'photorealistic city',
          'glossy sci-fi base',
          'dense dashboard cards over the town',
          'dark full-screen tactical UI replacing the town scene',
          'candidate-derived identity drift',
        ],
      },
      reference_assets: [
        { role: 'subject_anchor', subject_id: subject.id, path: approvedAnchor },
      ],
      policy: {
        must_use_approved_anchor: true,
        must_not_chain_from_candidate: true,
        must_review_after_generation: true,
      },
    };
  }

  private validateInput(input: PrepareGenerationInput): void {
    if (input.project_id !== this.projectId) {
      throw new VisualDirectorError('PROJECT_NOT_FOUND', `Unsupported project_id: ${input.project_id}.`);
    }
    if (!input.asset_type.trim() || !input.request_text.trim()) {
      throw new VisualDirectorError('INVALID_INPUT', 'asset_type and request_text must not be empty.');
    }
    if (input.subject_ids.length === 0) {
      throw new VisualDirectorError('INVALID_INPUT', 'At least one subject_id is required.');
    }
    if (input.subject_ids.length !== 1) {
      throw new VisualDirectorError('INVALID_INPUT', 'Personal Orbit generation currently supports exactly one subject.');
    }
    for (const subjectId of input.subject_ids) {
      if (!this.definition.subjects[subjectId]) {
        throw new VisualDirectorError('SUBJECT_NOT_FOUND', `Unknown subject_id: ${subjectId}.`, {
          subject_id: subjectId,
          known_subject_ids: Object.keys(this.definition.subjects),
        });
      }
    }
  }

  private resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.repoPath, relativePath);
    const prefix = this.repoPath.endsWith(path.sep) ? this.repoPath : `${this.repoPath}${path.sep}`;
    if (path.isAbsolute(relativePath) || (resolved !== this.repoPath && !resolved.startsWith(prefix))) {
      throw new VisualDirectorError('REFERENCE_OUTSIDE_REPO', 'A configured project path resolves outside the project repository.', {
        path: relativePath,
      });
    }
    return resolved;
  }

  private async ensureFile(filePath: string, label: string): Promise<void> {
    try {
      await access(filePath);
    } catch {
      throw new VisualDirectorError('REFERENCE_NOT_FOUND', `${label} does not exist.`, { path: filePath });
    }
  }
}
