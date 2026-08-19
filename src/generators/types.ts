import type { GenerationPackage } from '../domain/types.js';

export type ImageGenerationSize = '1024x1024' | '1024x1536' | '1536x1024';

export interface ImageGeneratorInput {
  generation_package: GenerationPackage;
  repository_path: string;
  prompt: string;
  size: ImageGenerationSize;
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
