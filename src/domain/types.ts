export type SceneContext = Record<string, unknown>;

export interface PrepareGenerationInput {
  project_id: string;
  asset_type: string;
  subject_ids: string[];
  request_text: string;
  scene_context?: SceneContext;
}

export interface AdoptAnchorInput {
  project_id: string;
  subject_id: string;
  candidate_path: string;
  approval: 'approve';
}

export interface AdoptAnchorResult {
  project_id: string;
  subject_id: string;
  approved_anchor_path: string;
  canon_path: string;
  changed: boolean;
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

export interface GenerationPackage {
  project_id: string;
  asset_type: string;
  prompt_package: PromptPackage;
  reference_assets: ReferenceAsset[];
  policy: {
    must_use_approved_anchor: boolean;
    must_not_chain_from_candidate: true;
    must_review_after_generation: true;
  };
}

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
