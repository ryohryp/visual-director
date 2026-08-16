import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createVisualDirectorCore } from './core/visual-director.js';
import { VisualDirectorError } from './domain/types.js';
import type { GenerationPackage } from './domain/types.js';

export const COMPILED_CANON_RELATIVE_PATH = '.visual-director/compiled-canon.json';

export interface CompiledCanonSubject {
  subject_id: string;
  display_name: string;
  subject_lock: string;
  approved_anchor_path: string;
  allowed_changes: string[];
  forbidden_changes: string[];
}

export interface CompiledCanon {
  schema_version: 1;
  project_id: string;
  source_revision: string;
  global_style_lock: string;
  world_direction: string[];
  avoid_block: string[];
  asset_type_rules: Record<string, {
    must_use_approved_anchor: boolean;
    must_not_chain_from_candidate: true;
    must_review_after_generation: true;
  }>;
  subjects: CompiledCanonSubject[];
  global_reference_path: string;
  policy: GenerationPackage['policy'];
}

export interface CompileRepositoryCanonInput {
  projectId: string;
  repositoryPath: string;
  outputPath?: string;
  check?: boolean;
}

export async function compileRepositoryCanon(input: CompileRepositoryCanonInput): Promise<CompiledCanon> {
  const repositoryPath = path.resolve(input.repositoryPath);
  const core = createVisualDirectorCore();
  await core.configureProject(input.projectId, repositoryPath);
  const overview = await core.getProjectVisualOverview({ project_id: input.projectId, repository_path: repositoryPath });
  if (overview.approved_anchors.length === 0) {
    throw new VisualDirectorError(
      'COMPILED_CANON_NO_APPROVED_ANCHORS',
      'Compiled Canon requires at least one Approved Visual Anchor so the repository-native flow can remain fail-closed.',
      { project_id: input.projectId },
    );
  }

  const prepared = await Promise.all(overview.approved_anchors.map(async (anchor) => ({
    anchor,
    generationPackage: await core.prepareGeneration({
      project_id: input.projectId,
      asset_type: 'character_visual_anchor',
      subject_ids: [anchor.subject_id],
      request_text: 'Compile repository Canon.',
      scene_context: { repository_path: repositoryPath },
    }),
  })));

  const baseline = prepared[0]?.generationPackage;
  if (!baseline) throw new VisualDirectorError('COMPILED_CANON_EMPTY', 'Compiled Canon could not resolve a baseline package.');
  const globalReference = baseline.reference_assets.find((asset) => asset.role === 'global_reference')?.path;
  if (!globalReference) {
    throw new VisualDirectorError('COMPILED_CANON_GLOBAL_REFERENCE_MISSING', 'Global reference is required for compiled Canon.');
  }

  const semanticPayload = {
    project_id: input.projectId,
    global_style_lock: baseline.prompt_package.style_lock,
    world_direction: baseline.prompt_package.scene_requirements
      .filter((rule) => rule.startsWith('World direction: '))
      .map((rule) => rule.slice('World direction: '.length)),
    avoid_block: baseline.prompt_package.avoid_block,
    asset_type_rules: {
      character_visual_anchor: { ...baseline.policy },
    },
    subjects: prepared
      .map(({ anchor, generationPackage }) => ({
        subject_id: anchor.subject_id,
        display_name: anchor.display_name,
        subject_lock: generationPackage.prompt_package.subject_lock[0] ?? '',
        approved_anchor_path: anchor.path,
        allowed_changes: [...generationPackage.prompt_package.allowed_changes],
        forbidden_changes: [...generationPackage.prompt_package.forbidden_changes],
      }))
      .sort((left, right) => left.subject_id.localeCompare(right.subject_id)),
    global_reference_path: globalReference,
    policy: { ...baseline.policy },
  };

  const compiled: CompiledCanon = {
    schema_version: 1,
    source_revision: createHash('sha256').update(stableJson(semanticPayload)).digest('hex'),
    ...semanticPayload,
  };

  const outputPath = path.resolve(repositoryPath, input.outputPath ?? COMPILED_CANON_RELATIVE_PATH);
  const serialized = `${stableJson(compiled)}\n`;
  if (input.check) {
    let current: string;
    try {
      current = await readFile(outputPath, 'utf8');
    } catch (error) {
      throw new VisualDirectorError('COMPILED_CANON_STALE', 'Compiled Canon is missing or unreadable.', {
        path: path.relative(repositoryPath, outputPath).replace(/\\/g, '/'),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (current !== serialized) {
      throw new VisualDirectorError('COMPILED_CANON_STALE', 'Compiled Canon is stale. Run `visual-director compile` and commit the result.', {
        path: path.relative(repositoryPath, outputPath).replace(/\\/g, '/'),
      });
    }
    return compiled;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, 'utf8');
  return compiled;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, sortJson(nested)]));
}
