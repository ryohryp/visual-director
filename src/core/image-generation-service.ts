import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { VisualDirectorError } from '../domain/types.js';
import type { GenerateImageInput, GenerateImageResult, GenerationPackage } from '../domain/types.js';
import type { ImageGenerator } from '../generators/types.js';
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
  await beginGenerationJob(request.repository_path, {
    job_id: request.job_id,
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
    const generated = await generator.generate({ generation_package: generationPackage, repository_path: request.repository_path, prompt: generationPrompt(generationPackage, request.request_text) });
    const candidatePath = `.visual-director/candidates/${safeId(request.job_id)}/${safeId(request.asset_id)}.${generated.extension}`;
    const absolute = path.resolve(request.repository_path, candidatePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, generated.bytes, { flag: 'wx' });

    await completeGenerationJob(request.repository_path, request.job_id, {
      asset_id: request.asset_id,
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
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) throw new VisualDirectorError('INVALID_INPUT', 'job_id and asset_id must use only letters, numbers, underscore, or hyphen.', { value });
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
