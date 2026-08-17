import { z } from 'zod';

import { VisualDirectorError } from '../../domain/types.js';

export const SUPPORTED_GRAND_DESIGN_VERSION = 1;

const nonEmptyString = z.string().trim().min(1);
const jsonObject = z.record(z.string(), z.unknown());
const grandDesignSchema = z.strictObject({
  schema_version: z.unknown(),
  project_id: z.unknown(),
  source_documents: z.array(nonEmptyString).optional(),
  visual_dna: z.unknown(),
  shared_rules: z.unknown(),
  fixed_avoid: z.unknown(),
  asset_types: z.unknown(),
  review_contract: z.unknown().optional(),
});

export interface GrandDesignDocument {
  schema_version: 1;
  project_id: string;
  source_documents?: string[];
  visual_dna: string;
  shared_rules: Record<string, unknown>;
  fixed_avoid: string[];
  asset_types: Record<string, Record<string, unknown>>;
  review_contract?: Record<string, unknown>;
}

export interface GrandDesignContract {
  schema_version: 1;
  visual_dna: string;
  shared_rules: Record<string, unknown>;
  fixed_avoid: string[];
  asset_type: string;
  asset_contract: Record<string, unknown>;
}

declare module '../../domain/types.js' {
  interface PromptPackage {
    grand_design_contract?: GrandDesignContract;
  }
}

export function parseGrandDesign(raw: string, expectedProjectId: string, path: string): GrandDesignDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new VisualDirectorError('GRAND_DESIGN_INVALID', 'Grand Design is not valid JSON.', {
      path,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const shape = grandDesignSchema.safeParse(parsed);
  if (!shape.success) {
    throw new VisualDirectorError('GRAND_DESIGN_INVALID', 'Grand Design must contain only supported top-level fields.', {
      path,
      reason: shape.error.issues[0]?.message,
    });
  }
  const value = shape.data;
  if (value.schema_version !== SUPPORTED_GRAND_DESIGN_VERSION) {
    throw new VisualDirectorError(
      'GRAND_DESIGN_VERSION_UNSUPPORTED',
      `Unsupported Grand Design schema version: ${String(value.schema_version)}.`,
      { path, supported_version: SUPPORTED_GRAND_DESIGN_VERSION },
    );
  }

  const projectId = nonEmptyString.safeParse(value.project_id);
  if (!projectId.success) throw invalid(path, 'project_id must be a non-empty string.');
  if (projectId.data !== expectedProjectId) {
    throw new VisualDirectorError('GRAND_DESIGN_PROJECT_MISMATCH', 'Grand Design project_id does not match the project manifest.', {
      path,
      expected_project_id: expectedProjectId,
      grand_design_project_id: projectId.data,
    });
  }

  const visualDna = nonEmptyString.safeParse(value.visual_dna);
  if (!visualDna.success) throw invalid(path, 'visual_dna must be a non-empty string.');
  const sharedRules = jsonObject.safeParse(value.shared_rules);
  if (!sharedRules.success) throw invalid(path, 'shared_rules must be an object.');
  const fixedAvoid = z.array(nonEmptyString).safeParse(value.fixed_avoid);
  if (!fixedAvoid.success) throw invalid(path, 'fixed_avoid must be an array of non-empty strings.');
  const assetTypes = z.record(z.string(), jsonObject).safeParse(value.asset_types);
  if (!assetTypes.success) throw invalid(path, 'asset_types must map asset type names to contract objects.');
  const reviewContract = value.review_contract === undefined ? undefined : jsonObject.safeParse(value.review_contract);
  if (reviewContract && !reviewContract.success) throw invalid(path, 'review_contract must be an object when present.');

  return {
    schema_version: 1,
    project_id: projectId.data,
    ...(value.source_documents ? { source_documents: [...value.source_documents] } : {}),
    visual_dna: visualDna.data,
    shared_rules: sharedRules.data,
    fixed_avoid: [...fixedAvoid.data],
    asset_types: assetTypes.data,
    ...(reviewContract?.success ? { review_contract: reviewContract.data } : {}),
  };
}

export function resolveGrandDesignContract(document: GrandDesignDocument, assetType: string): GrandDesignContract | undefined {
  const assetContract = document.asset_types[assetType];
  if (!assetContract) return undefined;
  return {
    schema_version: document.schema_version,
    visual_dna: document.visual_dna,
    shared_rules: document.shared_rules,
    fixed_avoid: document.fixed_avoid,
    asset_type: assetType,
    asset_contract: assetContract,
  };
}

function invalid(path: string, message: string): VisualDirectorError {
  return new VisualDirectorError('GRAND_DESIGN_INVALID', message, { path });
}
