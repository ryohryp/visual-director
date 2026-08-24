import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseRequiredAssetPlanValue } from '../src/domain/asset-plan.js';
import type { ProjectWorkflowSummary } from '../src/domain/types.js';
import { emptyProjectAssetInventory, loadProjectAssetInventory, reconcileProjectAssetInventory } from '../src/projects/asset-inventory.js';
import { LocalRepositorySource } from '../src/projects/repository-source.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Project Visual Asset Inventory reconciliation', () => {
  it('derives required, review, ready, broken, and unmanaged state from repository evidence', async () => {
    const root = await fixtureRoot();
    const source = new LocalRepositorySource(root);
    const plan = parseRequiredAssetPlanValue({
      version: 1,
      scan: { roots: ['public/images'], ignore: ['public/images/docs/**'] },
      assets: [
        required('ready-background', 'background', 'public/images/backgrounds/ready.webp'),
        required('review-cg', 'event_cg', 'public/images/events/review.webp'),
        required('missing-item', 'item', 'public/images/items/missing.png'),
        required('broken-production', 'background', 'public/images/backgrounds/broken.webp'),
        required('unregistered-production', 'event_cg', 'public/images/events/unregistered.png'),
        { ...required('optional-portrait', 'portrait', 'public/images/portraits/optional.png'), required: false },
      ],
    });
    const workflow: ProjectWorkflowSummary = {
      metadata_path: '.visual-director/asset-index.json',
      available: true,
      jobs: [
        job('job-ready', 'ready-background', 'registered'),
        job('job-review', 'review-cg', 'candidate', 'fingerprint-review'),
        job('job-broken', 'broken-production', 'registered'),
        job('job-managed', undefined, 'registered'),
      ],
      assets: [
        managed('ready-background', 'registered', { source_job_id: 'job-ready', registered_path: 'public/images/backgrounds/ready.webp' }),
        managed('candidate-42', 'candidate', { required_asset_id: 'review-cg', source_job_id: 'job-review', candidate_path: '.visual-director/candidates/review.png', reference_paths: ['public/images/references/source.png'] }),
        managed('broken-production', 'registered', { source_job_id: 'job-broken', registered_path: 'public/images/backgrounds/broken.webp' }),
        managed('managed-only', 'registered', { source_job_id: 'job-managed', registered_path: 'public/images/managed-only.png' }),
      ],
    };

    await Promise.all([
      file(root, 'public/images/backgrounds/ready.webp'),
      file(root, '.visual-director/candidates/review.png'),
      file(root, 'public/images/events/unregistered.png'),
      file(root, 'public/images/managed-only.png'),
      file(root, 'public/images/orphan.png'),
      file(root, 'public/images/docs/ignored.png'),
      file(root, 'public/images/anchors/hero.webp'),
      file(root, 'public/images/references/global.webp'),
      file(root, 'public/images/references/source.png'),
    ]);

    const inventory = await reconcileProjectAssetInventory({
      source,
      workflow,
      approvedAnchors: [{ subject_id: 'hero', display_name: 'Hero', asset_type: 'character_visual_anchor', path: 'public/images/anchors/hero.webp', status: 'approved' }],
      visualDirection: { grand_design: null, global_style: { role: 'global_style', asset_path: 'public/images/references/global.webp' } },
      plan,
    });

    expect(inventory.summary).toMatchObject({
      total_required: 5,
      total_optional: 1,
      ready: 1,
      review_required: 1,
      missing: 1,
      broken: 2,
      unmanaged: 1,
      managed_unplanned: 1,
    });
    expect(inventory.summary.ready + inventory.summary.review_required + inventory.summary.missing + inventory.summary.broken)
      .toBe(inventory.summary.total_required);
    expect(inventory.summary.by_asset_type.background).toMatchObject({ required: 2, ready: 1, broken: 1 });
    expect(statuses(inventory)).toMatchObject({
      'ready-background': 'READY',
      'review-cg': 'REVIEW_REQUIRED',
      'missing-item': 'MISSING',
      'broken-production': 'BROKEN',
      'unregistered-production': 'BROKEN',
      'optional-portrait': 'MISSING',
      'managed-only': 'READY',
    });

    const review = inventory.assets.find((item) => item.asset_id === 'review-cg');
    expect(review).toMatchObject({
      candidate_path: '.visual-director/candidates/review.png',
      preview_path: '.visual-director/candidates/review.png',
      current_lifecycle: 'candidate',
      required_definition: { usage: 'fixture usage' },
      source_jobs: [{ job_id: 'job-review', generation_package_fingerprint: 'fingerprint-review' }],
    });
    expect(inventory.assets.find((item) => item.asset_id === 'unregistered-production')?.issues)
      .toContainEqual(expect.objectContaining({ code: 'PRODUCTION_NOT_REGISTERED' }));
    expect(inventory.assets.filter((item) => item.status === 'UNMANAGED').map((item) => item.production_path))
      .toEqual(['public/images/orphan.png']);
  });

  it('fails closed when one workflow record points at conflicting Required Asset identities', async () => {
    const root = await fixtureRoot();
    await file(root, 'public/images/b.png');
    const source = new LocalRepositorySource(root);
    const plan = parseRequiredAssetPlanValue({
      version: 1,
      assets: [
        required('asset-a', 'background', 'public/images/a.png'),
        required('asset-b', 'background', 'public/images/b.png'),
      ],
    });
    const workflow: ProjectWorkflowSummary = {
      metadata_path: '.visual-director/asset-index.json',
      available: true,
      jobs: [],
      assets: [managed('version-1', 'registered', { required_asset_id: 'asset-a', registered_path: 'public/images/b.png' })],
    };

    await expect(reconcileProjectAssetInventory({
      source,
      workflow,
      approvedAnchors: [],
      visualDirection: { grand_design: null, global_style: { role: 'global_style' } },
      plan,
    })).rejects.toMatchObject({ code: 'ASSET_INVENTORY_CONFLICT' });
  });

  it('does not ignore a required_asset_id that is absent from the current plan', async () => {
    const root = await fixtureRoot();
    await Promise.all([
      file(root, 'public/images/current.png'),
      file(root, 'public/images/legacy.png'),
    ]);
    const source = new LocalRepositorySource(root);
    const plan = parseRequiredAssetPlanValue({
      version: 1,
      assets: [required('current-asset', 'background', 'public/images/current.png')],
    });
    const workflow: ProjectWorkflowSummary = {
      metadata_path: '.visual-director/asset-index.json',
      available: true,
      jobs: [],
      assets: [managed('legacy-asset', 'registered', {
        required_asset_id: 'removed-plan-entry',
        registered_path: 'public/images/legacy.png',
      })],
    };

    const inventory = await reconcileProjectAssetInventory({
      source,
      workflow,
      approvedAnchors: [],
      visualDirection: { grand_design: null, global_style: { role: 'global_style' } },
      plan,
    });

    expect(inventory.assets.find((item) => item.asset_id === 'legacy-asset')).toMatchObject({
      kind: 'managed',
      status: 'BROKEN',
      issues: [expect.objectContaining({ code: 'REQUIRED_ASSET_NOT_IN_PLAN' })],
    });
  });

  it('fails closed instead of using a path match when explicit Required Asset identity disagrees', async () => {
    const root = await fixtureRoot();
    await file(root, 'public/images/current.png');
    const plan = parseRequiredAssetPlanValue({
      version: 1,
      assets: [required('current-asset', 'background', 'public/images/current.png')],
    });
    const workflow: ProjectWorkflowSummary = {
      metadata_path: '.visual-director/asset-index.json',
      available: true,
      jobs: [],
      assets: [managed('legacy-asset', 'registered', {
        required_asset_id: 'removed-plan-entry',
        registered_path: 'public/images/current.png',
      })],
    };

    await expect(reconcileProjectAssetInventory({
      source: new LocalRepositorySource(root),
      workflow,
      approvedAnchors: [],
      visualDirection: { grand_design: null, global_style: { role: 'global_style' } },
      plan,
    })).rejects.toMatchObject({ code: 'ASSET_INVENTORY_CONFLICT' });
  });

  it('keeps an absent plan explicit and does not scan or infer required assets', async () => {
    const root = await fixtureRoot();
    await file(root, 'public/images/unconfigured.png');
    const inventory = await loadProjectAssetInventory({
      source: new LocalRepositorySource(root),
      workflow: { metadata_path: '.visual-director/asset-index.json', available: false, jobs: [], assets: [] },
      approvedAnchors: [],
      visualDirection: { grand_design: null, global_style: { role: 'global_style' } },
    });

    expect(inventory).toEqual(emptyProjectAssetInventory());
  });
});

function required(assetId: string, assetType: string, productionPath: string): Record<string, unknown> {
  return {
    asset_id: assetId,
    asset_type: assetType,
    title: assetId,
    usage: 'fixture usage',
    production_path: productionPath,
    subject_ids: [],
    required: true,
  };
}

function job(jobId: string, requiredAssetId: string | undefined, status: 'candidate' | 'registered', fingerprint?: string) {
  return {
    job_id: jobId,
    ...(requiredAssetId ? { required_asset_id: requiredAssetId } : {}),
    asset_type: 'fixture',
    subject_ids: [],
    request_text: `request ${jobId}`,
    status,
    ...(fingerprint ? { generation_package_fingerprint: fingerprint } : {}),
  };
}

function managed(
  assetId: string,
  status: 'candidate' | 'registered',
  overrides: Partial<ProjectWorkflowSummary['assets'][number]> = {},
): ProjectWorkflowSummary['assets'][number] {
  return { asset_id: assetId, asset_type: 'fixture', status, reference_paths: [], ...overrides };
}

function statuses(inventory: Awaited<ReturnType<typeof reconcileProjectAssetInventory>>): Record<string, string> {
  return Object.fromEntries(inventory.assets.flatMap((item) => item.asset_id ? [[item.asset_id, item.status]] : []));
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'visual-director-inventory-'));
  roots.push(root);
  return root;
}

async function file(root: string, relativePath: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from('fixture'));
}
