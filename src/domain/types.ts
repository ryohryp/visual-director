export type SceneContext = Record<string, unknown>;

export interface PrepareGenerationInput {
  project_id: string;
  asset_type: string;
  subject_ids: string[];
  request_text: string;
  scene_context?: SceneContext;
}

export interface ProjectVisualOverviewInput {
  project_id: string;
  repository_path?: string;
}

export interface AdoptAnchorInput {
  project_id: string;
  subject_id: string;
  candidate_file?: OpenAIFileReference;
  candidate_path?: string;
  approval: 'approve';
}

export interface OpenAIFileReference {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

export interface AdoptAnchorResult {
  project_id: string;
  subject_id: string;
  status: 'approved';
  anchor_path: string;
  approved_anchor_path: string;
  canon_path: string;
  changed: boolean;
  sha256: string;
  mime_type: string;
  width: number;
  height: number;
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

export type GenerationJobStatus =
  | 'requested'
  | 'prepared'
  | 'generating'
  | 'generated'
  | 'candidate'
  | 'approved'
  | 'rejected'
  | 'registered'
  | 'superseded'
  | 'failed';

export type ManagedAssetStatus = 'candidate' | 'approved' | 'rejected' | 'registered' | 'superseded';

export interface VisualReferenceSummary {
  role: 'grand_design' | 'global_style';
  document_path?: string;
  asset_path?: string;
}

export interface ApprovedAnchorSummary {
  subject_id: string;
  display_name: string;
  asset_type: 'character_visual_anchor';
  path: string;
  status: 'approved';
}

export interface GenerationJobSummary {
  job_id: string;
  asset_type: string;
  subject_ids: string[];
  request_text: string;
  status: GenerationJobStatus;
  generator?: string;
  generation_package_fingerprint?: string;
  created_at?: string;
  updated_at?: string;
  error?: string;
}

export interface ManagedVisualAssetSummary {
  asset_id: string;
  asset_type: string;
  status: ManagedAssetStatus;
  subject_id?: string;
  source_job_id?: string;
  candidate_path?: string;
  registered_path?: string;
  generator?: string;
  generation_package_fingerprint?: string;
  reference_paths: string[];
  created_at?: string;
  approved_at?: string;
  supersedes?: string;
}

export interface ProjectWorkflowSummary {
  metadata_path: '.visual-director/asset-index.json';
  available: boolean;
  jobs: GenerationJobSummary[];
  assets: ManagedVisualAssetSummary[];
}

export interface ProjectVisualOverview {
  project_id: string;
  visual_direction: {
    grand_design: VisualReferenceSummary | null;
    global_style: VisualReferenceSummary;
  };
  approved_anchors: ApprovedAnchorSummary[];
  workflow: ProjectWorkflowSummary;
}

export interface ProjectAdapter {
  projectId: string;
  prepare(input: PrepareGenerationInput): Promise<GenerationPackage>;
  getVisualOverview(): Promise<ProjectVisualOverview>;
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
