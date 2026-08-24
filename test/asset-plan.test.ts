import { describe, expect, it } from 'vitest';

import { ASSET_PLAN_PATH, parseRequiredAssetPlan, parseRequiredAssetPlanValue } from '../src/domain/asset-plan.js';

describe('Required Asset Plan schema', () => {
  it('normalizes a repository-owned plan without storing derived status', () => {
    const plan = parseRequiredAssetPlan(JSON.stringify({
      version: 1,
      scan: {
        roots: ['public\\images'],
        ignore: ['public/images/docs/**'],
      },
      assets: [{
        asset_id: 'chapter1_school_gate',
        asset_type: 'background',
        title: '第一章・校門',
        usage: 'chapter1 opening',
        production_path: 'public\\images\\backgrounds\\school-gate.webp',
        subject_ids: [],
        required: true,
        generation: {
          aspect_ratio: '16:9',
          request: '夕暮れの学校正門',
          requirements: ['central 9:16 crop remains readable'],
        },
      }],
    }));

    expect(plan).toEqual({
      version: 1,
      scan: { roots: ['public/images'], ignore: ['public/images/docs/**'] },
      assets: [{
        asset_id: 'chapter1_school_gate',
        asset_type: 'background',
        title: '第一章・校門',
        usage: 'chapter1 opening',
        production_path: 'public/images/backgrounds/school-gate.webp',
        subject_ids: [],
        required: true,
        generation: {
          aspect_ratio: '16:9',
          request: '夕暮れの学校正門',
          requirements: ['central 9:16 crop remains readable'],
        },
      }],
    });
    expect(JSON.stringify(plan)).not.toContain('status');
  });

  it.each([
    ['malformed JSON', '{', 'ASSET_PLAN_INVALID'],
    ['unsupported version', JSON.stringify({ version: 2, assets: [] }), 'ASSET_PLAN_INVALID'],
    ['unknown field', JSON.stringify({ version: 1, assets: [], database: true }), 'ASSET_PLAN_INVALID'],
    ['unsafe production path', JSON.stringify({ version: 1, assets: [asset({ production_path: '../escape.png' })] }), 'ASSET_PLAN_INVALID'],
    ['aliased production path', JSON.stringify({ version: 1, assets: [asset({ production_path: 'public/./images/scene.png' })] }), 'ASSET_PLAN_INVALID'],
    ['non-image production path', JSON.stringify({ version: 1, assets: [asset({ production_path: 'public/images/readme.txt' })] }), 'ASSET_PLAN_INVALID'],
    ['workflow scan root', JSON.stringify({ version: 1, scan: { roots: ['.visual-director'], ignore: [] }, assets: [] }), 'ASSET_PLAN_INVALID'],
  ])('fails closed for %s', (_label, raw, code) => {
    expect(() => parseRequiredAssetPlan(raw)).toThrow(expect.objectContaining({
      code,
      details: expect.objectContaining({ path: ASSET_PLAN_PATH }),
    }));
  });

  it('rejects duplicate logical IDs and production paths', () => {
    expect(() => parseRequiredAssetPlanValue({
      version: 1,
      assets: [
        asset({ asset_id: 'scene-a', production_path: 'public/images/a.png' }),
        asset({ asset_id: 'SCENE-A', production_path: 'public/images/b.png' }),
      ],
    })).toThrow(expect.objectContaining({ code: 'ASSET_PLAN_INVALID' }));

    expect(() => parseRequiredAssetPlanValue({
      version: 1,
      assets: [
        asset({ asset_id: 'scene-a', production_path: 'public/images/same.png' }),
        asset({ asset_id: 'scene-b', production_path: 'PUBLIC/IMAGES/SAME.PNG' }),
      ],
    })).toThrow(expect.objectContaining({ code: 'ASSET_PLAN_INVALID' }));
  });
});

function asset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asset_id: 'scene',
    asset_type: 'background',
    title: 'Scene',
    usage: 'test',
    production_path: 'public/images/scene.png',
    subject_ids: [],
    required: true,
    ...overrides,
  };
}
