import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createCatalogProjectAdapter } from '../src/projects/catalog-runtime.js';
import { parseProjectCatalog } from '../src/projects/catalog.js';
import { LocalRepositorySource } from '../src/projects/repository-source.js';

function catalogEntry(projectId = 'game-a') {
  return parseProjectCatalog({
    projects: [{
      project_id: projectId,
      display_name: projectId === 'bottom-of-thirst' ? 'The Bottom of Thirst' : 'Game A',
      repository: projectId === 'bottom-of-thirst' ? 'ryohryp/---The-Bottom-of-Thirst' : 'owner/game-a',
      ref: 'main',
      adapter_type: 'generic',
    }],
  }).resolve(projectId);
}

describe('catalog repository manifest adapter', () => {
  it('creates a generic adapter from the repository-owned manifest', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'visual-director-manifest-adapter-'));
    mkdirSync(path.join(root, '.visual-director'));
    writeFileSync(path.join(root, '.visual-director', 'manifest.json'), JSON.stringify({
      version: 1,
      project_id: 'game-a',
      subjects: {},
    }), 'utf8');

    const adapter = await createCatalogProjectAdapter(catalogEntry(), new LocalRepositorySource(root));
    expect(adapter.projectId).toBe('game-a');
  });

  it('rejects a repository manifest for a different project', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'visual-director-manifest-mismatch-'));
    mkdirSync(path.join(root, '.visual-director'));
    writeFileSync(path.join(root, '.visual-director', 'manifest.json'), JSON.stringify({
      version: 1,
      project_id: 'other-game',
    }), 'utf8');

    await expect(createCatalogProjectAdapter(catalogEntry(), new LocalRepositorySource(root)))
      .rejects.toThrow('Project manifest project_id does not match catalog project_id.');
  });

  it('prepares approved and new-anchor Bottom of Thirst subjects through the generic adapter', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'visual-director-bottom-of-thirst-generic-'));
    const files: Record<string, string | Buffer> = {
      '.visual-director/manifest.json': JSON.stringify({
        version: 1,
        project_id: 'bottom-of-thirst',
        documents: {
          globalStyle: 'docs/visual/GLOBAL_VISUAL_STYLE.md',
          characterCanon: 'docs/visual/CHARACTER_VISUAL_CANON.md',
          worldDirection: 'docs/WORLD_DIRECTION.md',
          assetManifest: 'docs/visual/assets/README.md',
          globalReference: 'docs/visual/assets/global_visual_style_reference.webp',
        },
        labels: {
          avoidBlockHeading: 'Fixed Avoid Block',
          allowedChangesHeading: '変更してよいもの',
          forbiddenChangesHeading: '変更してはいけないもの',
          commonRulesHeading: '共通ルール',
          acceptedConditionsHeading: '採用する視覚条件',
        },
        subjects: {
          kamino_kyosuke: {
            display_name: '神野 恭介',
            character_file: 'docs/characters/kyosuke.md',
            canon_heading: '神野 恭介',
            aliases: ['神野', '恭介', 'Kamino Kyosuke'],
          },
          mikoshiba: {
            display_name: '御子柴 徹',
            character_file: 'docs/characters/mikoshiba.md',
            canon_heading: '御子柴 徹',
            aliases: ['御子柴'],
            anchor_requirements_file: 'docs/visual/MIKOSHIBA_VISUAL_ANCHOR_V2_REQUIREMENTS.md',
            required_new_anchor_terms: ['25歳', '刑事'],
          },
        },
      }),
      'docs/visual/GLOBAL_VISUAL_STYLE.md': '# Global Style\n\n```text\nSTYLE LOCK\n```\n\n### Fixed Avoid Block\n\n```text\nAVOID: photorealism, anime\n```\n\n### 変更してよいもの\n- 視線\n\n### 変更してはいけないもの\n- 顔立ち\n',
      'docs/visual/CHARACTER_VISUAL_CANON.md': '# Canon\n\n## 共通ルール\n- Approved Anchorを正本にする\n\n## 神野 恭介\n\n### Approved Visual Anchor\n- `public/images/characters/kamino_kyosuke/v2/default.avif`\n\n### 採用する視覚条件\n- 24歳の日本人男性\n- 動画配信者\n\n## 御子柴 徹\n\n### 採用する視覚条件\n- 25歳の刑事\n',
      'docs/WORLD_DIRECTION.md': '# World\n\n- 普通の光の中で違和感を作る\n',
      'docs/characters/kyosuke.md': '# 神野 恭介\n\n- 24歳\n- 動画配信者\n- ジンバルを使う\n',
      'docs/characters/mikoshiba.md': '# 御子柴 徹\n\n- 25歳\n- 刑事\n- 冷静で観察力が高い\n',
      'docs/visual/MIKOSHIBA_VISUAL_ANCHOR_V2_REQUIREMENTS.md': '# Requirements\n\n- 25歳の刑事として自然な外見\n- 他キャラクターの顔を流用しない\n',
      'docs/visual/assets/README.md': '# Assets\n\nRepository-owned visual assets.\n',
      'docs/visual/assets/global_visual_style_reference.webp': Buffer.from('global-reference'),
      'public/images/characters/kamino_kyosuke/v2/default.avif': Buffer.from('approved-anchor'),
    };

    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(root, relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content);
    }

    const adapter = await createCatalogProjectAdapter(
      catalogEntry('bottom-of-thirst'),
      new LocalRepositorySource(root),
    );
    const prepared = await adapter.prepare({
      project_id: 'bottom-of-thirst',
      asset_type: 'event_cg',
      subject_ids: ['Kamino Kyosuke'],
      request_text: '神野恭介をApproved Anchorから描く。',
    });
    expect(prepared.reference_assets).toContainEqual({
      role: 'subject_anchor',
      subject_id: 'kamino_kyosuke',
      path: 'public/images/characters/kamino_kyosuke/v2/default.avif',
    });
    expect(prepared.prompt_package.subject_lock.join('\n')).toContain('神野 恭介 (kamino_kyosuke)');

    const newAnchor = await adapter.prepare({
      project_id: 'bottom-of-thirst',
      asset_type: 'visual_anchor',
      subject_ids: ['御子柴'],
      request_text: '御子柴徹の初期Approved Visual Anchor候補を作る。',
    });
    expect(newAnchor.asset_type).toBe('character_visual_anchor');
    expect(newAnchor.policy.must_use_approved_anchor).toBe(false);
    expect(newAnchor.reference_assets).not.toContainEqual(expect.objectContaining({ role: 'subject_anchor' }));
    expect(newAnchor.prompt_package.subject_lock.join('\n')).toContain('NEW VISUAL ANCHOR CANDIDATE');
    expect(newAnchor.prompt_package.subject_lock.join('\n')).toContain('25歳の刑事');

    const overview = await adapter.getVisualOverview();
    expect(overview.project_id).toBe('bottom-of-thirst');
    expect(overview.approved_anchors).toContainEqual({
      subject_id: 'kamino_kyosuke',
      display_name: '神野 恭介',
      asset_type: 'character_visual_anchor',
      path: 'public/images/characters/kamino_kyosuke/v2/default.avif',
      status: 'approved',
    });
    expect(overview.approved_anchors).not.toContainEqual(expect.objectContaining({ subject_id: 'mikoshiba' }));
  });
});
