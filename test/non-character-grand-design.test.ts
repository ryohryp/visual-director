import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createCatalogProjectAdapter } from '../src/projects/catalog-runtime.js';
import { parseProjectCatalog } from '../src/projects/catalog.js';
import { LocalRepositorySource } from '../src/projects/repository-source.js';

function createBackgroundProject(allowNewAsset = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'visual-director-non-character-'));
  const files: Record<string, string | Buffer> = {
    '.visual-director/manifest.json': JSON.stringify({
      version: 1,
      project_id: 'bottom-of-thirst',
      documents: {
        grandDesign: '.visual-director/grand-design.json',
        globalStyle: 'docs/visual/CHARACTER_ONLY_STYLE.md',
        characterCanon: 'docs/visual/CHARACTER_ONLY_CANON.md',
        worldDirection: 'docs/WORLD_DIRECTION.md',
        assetManifest: 'docs/visual/assets/README.md',
        globalReference: 'docs/visual/assets/character_only_reference.webp',
      },
      subjects: {},
    }),
    '.visual-director/grand-design.json': JSON.stringify({
      schema_version: 1,
      project_id: 'bottom-of-thirst',
      visual_dna: 'ordinary first, evidence before horror',
      shared_rules: { practical_light_sources_only: true, reference_before_regeneration: true },
      fixed_avoid: ['generic horror', 'gratuitous fog'],
      asset_types: {
        background: {
          purpose: 'observation base',
          variation_policy: 'preserve location identity',
          ...(allowNewAsset ? { source_reference_required: false } : {}),
          forbidden: ['invent supernatural evidence', 'change location for drama'],
        },
      },
    }),
    'docs/WORLD_DIRECTION.md': '# World\n\n- 普通の場所として先に成立させる\n- 水と乾きは物語上の事実へ接続する\n',
    'docs/visual/assets/character_only_reference.webp': Buffer.from('global-reference'),
    'public/images/backgrounds/underground_stairs.jpg': Buffer.from('production-background'),
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }

  const entry = parseProjectCatalog({
    projects: [{
      project_id: 'bottom-of-thirst',
      display_name: 'The Bottom of Thirst',
      repository: 'ryohryp/---The-Bottom-of-Thirst',
      ref: 'main',
      adapter_type: 'generic',
    }],
  }).resolve('bottom-of-thirst');

  return { root, entry };
}

describe('non-character Grand Design preparation', () => {
  it('prepares a subjectless background from an explicit production source asset', async () => {
    const { root, entry } = createBackgroundProject();
    const adapter = await createCatalogProjectAdapter(entry, new LocalRepositorySource(root));

    const prepared = await adapter.prepare({
      project_id: 'bottom-of-thirst',
      asset_type: 'background',
      subject_ids: [],
      request_text: '11段目までは乾燥、12段目中央だけ濡れ、13段目以降を濡らす。',
      scene_context: {
        reference_paths: ['public/images/backgrounds/underground_stairs.jpg'],
        evidence: 'No leak on walls or ceiling; preserve the stair location and camera.',
      },
    });

    expect(prepared.asset_type).toBe('background');
    expect(prepared.prompt_package.subject_lock).toEqual([]);
    expect(prepared.prompt_package.style_lock).toContain('ordinary first, evidence before horror');
    expect(prepared.prompt_package.style_lock).toContain('observation base');
    expect(JSON.stringify(prepared.prompt_package)).not.toContain('CHARACTER_ONLY');
    expect(prepared.prompt_package.grand_design_contract).toEqual(expect.objectContaining({
      asset_type: 'background',
      asset_contract: expect.objectContaining({ purpose: 'observation base' }),
    }));
    expect(prepared.prompt_package.scene_requirements.join('\n')).not.toContain('reference_paths');
    expect(prepared.reference_assets).toEqual([
      { role: 'global_reference', path: 'docs/visual/assets/character_only_reference.webp' },
      { role: 'source_asset', path: 'public/images/backgrounds/underground_stairs.jpg' },
    ]);
    expect(prepared.policy).toEqual({
      must_use_approved_anchor: false,
      must_not_chain_from_candidate: true,
      must_review_after_generation: true,
    });
  });

  it('prepares a new subjectless asset from the Global Visual Reference when Grand Design explicitly allows it', async () => {
    const { root, entry } = createBackgroundProject(true);
    const adapter = await createCatalogProjectAdapter(entry, new LocalRepositorySource(root));

    const prepared = await adapter.prepare({
      project_id: 'bottom-of-thirst',
      asset_type: 'background',
      subject_ids: [],
      request_text: '新しい観察地点の背景を作る。',
      scene_context: { aspect_ratio: '16:9' },
    });

    expect(prepared.reference_assets).toEqual([
      { role: 'global_reference', path: 'docs/visual/assets/character_only_reference.webp' },
    ]);
    expect(prepared.prompt_package.allowed_changes.join('\n')).toContain('Create a new subjectless visual asset');
    expect(prepared.prompt_package.forbidden_changes.join('\n')).not.toContain('Do not redesign the referenced location');
    expect(prepared.prompt_package.scene_requirements.join('\n')).toContain('aspect_ratio: 16:9');
  });

  it('fails closed without an explicit source asset', async () => {
    const { root, entry } = createBackgroundProject();
    const adapter = await createCatalogProjectAdapter(entry, new LocalRepositorySource(root));

    await expect(adapter.prepare({
      project_id: 'bottom-of-thirst',
      asset_type: 'background',
      subject_ids: [],
      request_text: '背景を修正する。',
      scene_context: {},
    })).rejects.toMatchObject({ code: 'REFERENCE_REQUIRED' });
  });

  it('rejects missing, workflow, and escaping references', async () => {
    const { root, entry } = createBackgroundProject();
    const adapter = await createCatalogProjectAdapter(entry, new LocalRepositorySource(root));

    await expect(adapter.prepare({
      project_id: 'bottom-of-thirst', asset_type: 'background', subject_ids: [], request_text: '背景を修正する。',
      scene_context: { reference_paths: ['public/images/backgrounds/missing.jpg'] },
    })).rejects.toMatchObject({ code: 'REFERENCE_NOT_FOUND' });

    await expect(adapter.prepare({
      project_id: 'bottom-of-thirst', asset_type: 'background', subject_ids: [], request_text: '背景を修正する。',
      scene_context: { reference_paths: ['.visual-director/candidates/job-1/candidate.webp'] },
    })).rejects.toMatchObject({ code: 'REFERENCE_OUTSIDE_PRODUCTION' });

    await expect(adapter.prepare({
      project_id: 'bottom-of-thirst', asset_type: 'background', subject_ids: [], request_text: '背景を修正する。',
      scene_context: { reference_paths: ['../outside.jpg'] },
    })).rejects.toMatchObject({ code: 'REFERENCE_OUTSIDE_REPO' });
  });

  it('only permits subjectless asset types explicitly defined by Grand Design', async () => {
    const { root, entry } = createBackgroundProject();
    const adapter = await createCatalogProjectAdapter(entry, new LocalRepositorySource(root));

    await expect(adapter.prepare({
      project_id: 'bottom-of-thirst',
      asset_type: 'unknown_asset',
      subject_ids: [],
      request_text: '何かを作る。',
      scene_context: { reference_paths: ['public/images/backgrounds/underground_stairs.jpg'] },
    })).rejects.toMatchObject({ code: 'GRAND_DESIGN_ASSET_TYPE_UNSUPPORTED' });

    await expect(adapter.prepare({
      project_id: 'bottom-of-thirst',
      asset_type: 'character_visual_anchor',
      subject_ids: [],
      request_text: '人物を作る。',
      scene_context: { reference_paths: ['public/images/backgrounds/underground_stairs.jpg'] },
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
