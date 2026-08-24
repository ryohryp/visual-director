import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { VisualDirectorError } from '../domain/types.js';
import type { GenerateImageInput, GenerateImageResult, GenerationPackage } from '../domain/types.js';
import type { ImageGenerationSize, ImageGenerator } from '../generators/types.js';
import { beginGenerationJob, completeGenerationJob, failGenerationJob } from '../projects/generation-workflow-store.js';

export interface ImageGenerationServiceInput {
  request: GenerateImageInput;
  generationPackage: GenerationPackage;
  generator: ImageGenerator;
}

export async function runImageGeneration(input: ImageGenerationServiceInput): Promise<GenerateImageResult> {
  const { request, generationPackage, generator } = input;
  const fingerprint = fingerprintGenerationPackage(generationPackage);
  const now = new Date().toISOString();
  const requiredAssetId = request.required_asset_id?.trim() ? safeId(request.required_asset_id) : undefined;
  await beginGenerationJob(request.repository_path, {
    job_id: request.job_id,
    ...(requiredAssetId ? { required_asset_id: requiredAssetId } : {}),
    asset_type: request.asset_type,
    subject_ids: [...request.subject_ids],
    request_text: request.request_text,
    status: 'generating',
    generator: generator.id,
    generation_package_fingerprint: fingerprint,
    created_at: now,
    updated_at: now,
  });

  try {
    const generated = await generator.generate({
      generation_package: generationPackage,
      repository_path: request.repository_path,
      prompt: generationPrompt(generationPackage, request.request_text),
      size: resolveImageGenerationSize(request, generationPackage),
    });
    const candidatePath = `.visual-director/candidates/${safeId(request.job_id)}/${safeId(request.asset_id)}.${generated.extension}`;
    const absolute = path.resolve(request.repository_path, candidatePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, generated.bytes, { flag: 'wx' });

    await completeGenerationJob(request.repository_path, request.job_id, {
      asset_id: request.asset_id,
      ...(requiredAssetId ? { required_asset_id: requiredAssetId } : {}),
      asset_type: request.asset_type,
      status: 'candidate',
      ...(request.subject_ids.length === 1 && request.subject_ids[0] ? { subject_id: request.subject_ids[0] } : {}),
      source_job_id: request.job_id,
      candidate_path: candidatePath,
      generator: generated.generator,
      generation_package_fingerprint: fingerprint,
      reference_paths: generationPackage.reference_assets.map((asset) => asset.path),
      created_at: now,
    });

    return { project_id: request.project_id, job_id: request.job_id, asset_id: request.asset_id, status: 'candidate', candidate_path: candidatePath, generator: generated.generator, generation_package_fingerprint: fingerprint };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { await failGenerationJob(request.repository_path, request.job_id, message); } catch { /* Preserve generator failure. */ }
    if (error instanceof VisualDirectorError) throw error;
    throw new VisualDirectorError('GENERATOR_FAILED', 'Image generation failed.', { reason: message });
  }
}

export function fingerprintGenerationPackage(generationPackage: GenerationPackage): string {
  return createHash('sha256').update(stableJson(generationPackage)).digest('hex');
}

export function resolveImageGenerationSize(
  request: Pick<GenerateImageInput, 'asset_type' | 'scene_context'>,
  generationPackage: GenerationPackage,
): ImageGenerationSize {
  for (const key of ['aspect_ratio', 'aspectRatio', 'orientation']) {
    const value = request.scene_context?.[key];
    if (typeof value !== 'string') continue;
    const explicit = sizeFromExplicitHint(value);
    if (explicit) return explicit;
  }

  const contextText = stableJson(request.scene_context ?? {}).toLowerCase();
  const contextPrimary = sizeFromPrimaryComposition(contextText);
  if (contextPrimary) return contextPrimary;

  const requirements = generationPackage.prompt_package.scene_requirements.join('\n').toLowerCase();
  const packagePrimary = sizeFromPrimaryComposition(requirements);
  if (packagePrimary) return packagePrimary;

  if (request.asset_type.trim().toLowerCase().includes('background')) return '1536x1024';
  return '1024x1536';
}

function sizeFromExplicitHint(value: string): ImageGenerationSize | undefined {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  if (normalized === '16:9' || normalized === 'landscape' || normalized === 'horizontal') return '1536x1024';
  if (normalized === '9:16' || normalized === 'portrait' || normalized === 'vertical') return '1024x1536';
  if (normalized === '1:1' || normalized === 'square') return '1024x1024';
  return undefined;
}

function sizeFromPrimaryComposition(value: string): ImageGenerationSize | undefined {
  if (value.includes('16:9 primary') || value.includes('primary 16:9')) return '1536x1024';
  if (value.includes('9:16 primary') || value.includes('primary 9:16')) return '1024x1536';
  if (value.includes('1:1 primary') || value.includes('primary 1:1')) return '1024x1024';
  return undefined;
}

function generationPrompt(generationPackage: GenerationPackage, requestText: string): string {
  const p = generationPackage.prompt_package;
  return [
    requestText.trim(),
    '',
    ...(p.grand_design_contract ? [`GRAND DESIGN CONTRACT: ${stableJson(p.grand_design_contract)}`] : []),
    `STYLE LOCK: ${p.style_lock}`,
    ...p.subject_lock.map((value) => `SUBJECT LOCK: ${value}`),
    ...p.scene_requirements.map((value) => `SCENE REQUIREMENT: ${value}`),
    ...p.allowed_changes.map((value) => `ALLOWED CHANGE: ${value}`),
    ...p.forbidden_changes.map((value) => `FORBIDDEN CHANGE: ${value}`),
    ...p.avoid_block.map((value) => `AVOID: ${value}`),
    '',
    'Treat the supplied reference images as visual source-of-truth constraints. Do not redesign the subject identity or global art direction.',
  ].join('\n');
}

function safeId(value: string): string {
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed)) throw new VisualDirectorError('INVALID_INPUT', 'Workflow identifiers must use only letters, numbers, dot, underscore, or hyphen.', { value });
  return trimmed;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
