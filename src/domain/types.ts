export type SceneContext = Record<string, unknown>;

export interface PrepareGenerationInput {
  project_id: string;
  asset_type: string;
  subject_ids: string[];
  request_text: string;
  scene_context?: SceneContext;
}

export interface ReferenceAsset {
  role: 'global_reference' | 'subject_anchor';
  path: string;
  subject_id?: string;
}

export interface PromptPackage {
  style_lock: string;
  subject_lock: string[];
  scene_requirements: string[];
  allowed_changes: string[];
  forbidden_changes: string[];
  avoid_block: string[];
}

export const GENERATION_PACKAGE_SCHEMA_VERSION = 1;

export interface GenerationPackage {
  project_id: string;
  asset_type: string;
  schema_version: number;
  prompt_package: PromptPackage;
  reference_assets: ReferenceAsset[];
  policy: {
    must_use_approved_anchor: boolean;
    must_not_chain_from_candidate: true;
    must_review_after_generation: true;
  };
  fingerprint: string;
}

/** The Generation Package fields the fingerprint is computed over. */
export type FingerprintedGenerationPackage = Omit<GenerationPackage, 'fingerprint'>;

export interface ProjectAdapter {
  projectId: string;
  prepare(input: PrepareGenerationInput): Promise<GenerationPackage>;
}

export class VisualDirectorError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'VisualDirectorError';
    this.code = code;
    this.details = details;
  }
}
