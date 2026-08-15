import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { VisualDirectorError } from '../domain/types.js';
import type { ImageGenerator, ImageGeneratorInput, GeneratedImage } from './types.js';

export interface OpenAIImageGeneratorOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export class OpenAIImageGenerator implements ImageGenerator {
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIImageGeneratorOptions = {}) {
    this.apiKey = options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || '';
    this.model = options.model?.trim() || process.env.VISUAL_DIRECTOR_OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-1';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.id = `openai:${this.model}`;
  }

  async generate(input: ImageGeneratorInput): Promise<GeneratedImage> {
    if (!this.apiKey) {
      throw new VisualDirectorError('GENERATOR_NOT_CONFIGURED', 'OPENAI_API_KEY is required for the OpenAI image generator.');
    }
    const references = input.generation_package.reference_assets;
    if (references.length === 0) {
      throw new VisualDirectorError('GENERATOR_REFERENCE_MISSING', 'Generation Package must contain at least one reference asset.');
    }

    const form = new FormData();
    form.set('model', this.model);
    form.set('prompt', input.prompt);
    form.set('input_fidelity', 'high');
    form.set('quality', 'high');
    form.set('output_format', 'webp');
    form.set('size', '1024x1536');

    for (const reference of references) {
      const absolute = path.resolve(input.repository_path, safeRelativePath(reference.path));
      const bytes = await readFile(absolute);
      form.append('image[]', new Blob([bytes], { type: mimeType(reference.path) }), path.basename(reference.path));
    }

    let response: Response;
    try {
      response = await this.fetchImpl('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
    } catch (error) {
      throw generatorFailed('OpenAI image generation request failed before a response was received.', error);
    }

    const body = await response.text();
    if (!response.ok) {
      throw new VisualDirectorError('GENERATOR_FAILED', 'OpenAI image generation request failed.', {
        status: response.status,
        response: safeErrorBody(body),
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      throw generatorFailed('OpenAI image generation returned invalid JSON.', error);
    }
    const b64 = imageBase64(parsed);
    if (!b64) {
      throw new VisualDirectorError('GENERATOR_FAILED', 'OpenAI image generation returned no image data.');
    }
    return {
      bytes: Buffer.from(b64, 'base64'),
      mime_type: 'image/webp',
      extension: 'webp',
      generator: this.id,
    };
  }
}

function safeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'Reference asset path must be repository-relative.', { path: value });
  }
  return normalized;
}

function mimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.avif')) return 'image/avif';
  throw new VisualDirectorError('GENERATOR_REFERENCE_UNSUPPORTED', 'Reference image format is not supported by the initial generator adapter.', { path: filePath });
}

function imageBase64(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return undefined;
  const first = data[0];
  if (!first || typeof first !== 'object') return undefined;
  const b64 = (first as { b64_json?: unknown }).b64_json;
  return typeof b64 === 'string' && b64.length > 0 ? b64 : undefined;
}

function safeErrorBody(body: string): string {
  return body.length <= 2000 ? body : `${body.slice(0, 2000)}…`;
}

function generatorFailed(message: string, error: unknown): VisualDirectorError {
  return new VisualDirectorError('GENERATOR_FAILED', message, {
    reason: error instanceof Error ? error.message : String(error),
  });
}
