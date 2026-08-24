import path from 'node:path';

import { z } from 'zod';

import { VisualDirectorError } from './types.js';
import type { RequiredAssetDefinition, RequiredAssetPlan } from './types.js';

export const ASSET_PLAN_PATH = '.visual-director/asset-plan.json' as const;
export const SUPPORTED_ASSET_PLAN_VERSION = 1 as const;

const nonEmptyString = z.string().trim().min(1);
const generationSchema = z.strictObject({
  aspect_ratio: nonEmptyString.optional(),
  request: nonEmptyString.optional(),
  requirements: z.array(nonEmptyString).optional().default([]),
}).refine(
  (value) => Boolean(value.aspect_ratio || value.request || value.requirements.length),
  { message: 'generation must contain at least one generation requirement.' },
);
const assetSchema = z.strictObject({
  asset_id: nonEmptyString,
  asset_type: nonEmptyString,
  title: nonEmptyString,
  usage: nonEmptyString,
  production_path: nonEmptyString,
  subject_ids: z.array(nonEmptyString).optional().default([]),
  required: z.boolean(),
  generation: generationSchema.optional(),
});
const scanSchema = z.strictObject({
  roots: z.array(nonEmptyString),
  ignore: z.array(nonEmptyString).optional().default([]),
});
const planSchema = z.strictObject({
  version: z.literal(SUPPORTED_ASSET_PLAN_VERSION),
  scan: scanSchema.optional().default({ roots: [], ignore: [] }),
  assets: z.array(assetSchema),
});

export function parseRequiredAssetPlan(raw: string, planPath: string = ASSET_PLAN_PATH): RequiredAssetPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw invalidPlan('Required Asset Plan is not valid JSON.', planPath, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return parseRequiredAssetPlanValue(parsed, planPath);
}

export function parseRequiredAssetPlanValue(input: unknown, planPath: string = ASSET_PLAN_PATH): RequiredAssetPlan {
  const result = planSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? issue.path.join('.') : 'plan';
    const message = issue?.code === 'unrecognized_keys'
      ? `Required Asset Plan contains unsupported key: ${issue.keys[0]}.`
      : `Required Asset Plan ${field} is invalid${issue?.message ? `: ${issue.message}` : '.'}`;
    throw invalidPlan(message, planPath);
  }

  const roots = uniqueNormalized(
    result.data.scan.roots.map((value, index) => safeScanRoot(value, `scan.roots[${index}]`, planPath)),
    'scan root',
    planPath,
  );
  const ignore = uniqueNormalized(
    result.data.scan.ignore.map((value, index) => safeIgnorePattern(value, `scan.ignore[${index}]`, planPath)),
    'ignore rule',
    planPath,
  );
  const assetIds = new Set<string>();
  const productionPaths = new Set<string>();
  const assets = result.data.assets.map((asset, index): RequiredAssetDefinition => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(asset.asset_id)) {
      throw invalidPlan(`assets[${index}].asset_id must use only letters, numbers, dot, underscore, or hyphen.`, planPath);
    }
    const assetIdKey = comparisonKey(asset.asset_id);
    if (assetIds.has(assetIdKey)) throw invalidPlan(`Required Asset Plan contains duplicate asset_id: ${asset.asset_id}.`, planPath);
    assetIds.add(assetIdKey);

    const productionPath = safeRepositoryPath(asset.production_path, `assets[${index}].production_path`, planPath);
    if (productionPath.startsWith('.visual-director/')) {
      throw invalidPlan(`assets[${index}].production_path must point to a production image outside .visual-director/.`, planPath);
    }
    if (!isImagePath(productionPath)) {
      throw invalidPlan(`assets[${index}].production_path must use a supported image extension.`, planPath);
    }
    const productionKey = comparisonKey(productionPath);
    if (productionPaths.has(productionKey)) {
      throw invalidPlan(`Required Asset Plan contains duplicate production_path: ${productionPath}.`, planPath);
    }
    productionPaths.add(productionKey);

    const subjectIds = uniqueValues(asset.subject_ids, `assets[${index}].subject_ids`, planPath);
    return {
      asset_id: asset.asset_id,
      asset_type: asset.asset_type,
      title: asset.title,
      usage: asset.usage,
      production_path: productionPath,
      subject_ids: subjectIds,
      required: asset.required,
      ...(asset.generation ? {
        generation: {
          ...(asset.generation.aspect_ratio ? { aspect_ratio: asset.generation.aspect_ratio } : {}),
          ...(asset.generation.request ? { request: asset.generation.request } : {}),
          requirements: uniqueValues(asset.generation.requirements, `assets[${index}].generation.requirements`, planPath),
        },
      } : {}),
    };
  });

  return {
    version: SUPPORTED_ASSET_PLAN_VERSION,
    scan: { roots, ignore },
    assets,
  };
}

export function safeRepositoryPath(value: string, field = 'path', planPath: string = ASSET_PLAN_PATH): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  const segments = normalized.split('/');
  if (
    !normalized
    || normalized === '.'
    || normalized.startsWith('/')
    || /^[a-zA-Z]:/.test(normalized)
    || segments.includes('.')
    || segments.includes('..')
    || hasControlCharacters(normalized)
  ) {
    throw invalidPlan(`${field} must be a safe repository-relative path.`, planPath, { [field]: value });
  }
  return normalized;
}

export function isImagePath(value: string): boolean {
  return new Set(['.avif', '.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg']).has(path.posix.extname(value).toLowerCase());
}

function safeScanRoot(value: string, field: string, planPath: string): string {
  const root = safeRepositoryPath(value, field, planPath).replace(/\/$/, '');
  if (root === '.visual-director' || root.startsWith('.visual-director/')) {
    throw invalidPlan(`${field} must not scan Visual Director workflow storage.`, planPath, { [field]: value });
  }
  return root;
}

function safeIgnorePattern(value: string, field: string, planPath: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  const segments = normalized.split('/');
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.startsWith('!')
    || /^[a-zA-Z]:/.test(normalized)
    || segments.includes('.')
    || segments.includes('..')
    || hasControlCharacters(normalized)
  ) {
    throw invalidPlan(`${field} must be a safe repository-relative glob.`, planPath, { [field]: value });
  }
  return normalized;
}

function uniqueNormalized(values: string[], label: string, planPath: string): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const key = comparisonKey(value);
    if (seen.has(key)) throw invalidPlan(`Required Asset Plan contains duplicate ${label}: ${value}.`, planPath);
    seen.add(key);
  }
  return values;
}

function uniqueValues(values: string[], field: string, planPath: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = comparisonKey(trimmed);
    if (seen.has(key)) throw invalidPlan(`${field} contains duplicate value: ${trimmed}.`, planPath);
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function comparisonKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) <= 0x1f);
}

function invalidPlan(message: string, planPath: string, details: Record<string, unknown> = {}): VisualDirectorError {
  return new VisualDirectorError('ASSET_PLAN_INVALID', message, { path: planPath, ...details });
}
