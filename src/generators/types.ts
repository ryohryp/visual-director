import type { GenerationPackage } from '../domain/types.js';

export interface ImageGeneratorInput {
  generation_package: GenerationPackage;
  repository_path: string;
  prompt: string;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mime_type: 'image/png' | 'image/webp' | 'image/jpeg';
  extension: 'png' | 'webp' | 'jpg';
  generator: string;
}

export interface ImageGenerator {
  readonly id: string;
  generate(input: ImageGeneratorInput): Promise<GeneratedImage>;
}
