import { describe, expect, it } from 'vitest';

import { CanonProjectAdapter } from '../src/projects/canon/adapter.js';
import { parseRepositoryCanonManifest } from '../src/projects/canon/repository-manifest.js';
import type { RepositorySource } from '../src/projects/repository-source.js';

const documents = {
  globalStyle: 'docs/style.md',
  characterCanon: 'docs/canon.md',
  worldDirection: 'docs/world.md',
  assetManifest: 'docs/assets.md',
  globalReference: 'public/global.webp',
};

function manifest(status?: 'active' | 'replacement_pending') {
  return parseRepositoryCanonManifest({
    version: 1,
    project_id: 'demo',
    documents,
    subjects: {
      kitou: {
        display_name: '鬼頭',
        character_file: 'docs/kitou.md',
        canon_heading: '鬼頭',
        anchor_requirements_file: 'docs/kitou-anchor.md',
        required_new_anchor_terms: ['短髪'],
        ...(status ? { anchor_generation_status: status } : {}),
      },
    },
  });
}

class MemorySource implements RepositorySource {
  readonly kind = 'local' as const;
  constructor(private readonly texts: Record<string, string>, private readonly files: Set<string>) {}
  async checkAccess(): Promise<void> {}
  async readText(path: string): Promise<string> {
    const value = this.texts[path];
    if (value === undefined) throw new Error(`unexpected read: ${path}`);
    return value;
  }
  async ensureFile(path: string): Promise<void> {
    if (!this.files.has(path)) throw new Error(`unexpected missing file: ${path}`);
  }
  async fileExists(path: string): Promise<boolean> { return this.files.has(path); }
}

function source(includeApprovedAnchor: boolean) {
  const texts = {
    'docs/style.md': [
      '```text',
      'cinematic restrained realism',
      '```',
      '## Fixed Avoid Block',
      '```text',
      'AVOID: anime, glossy skin',
      '```',
      '## Allowed Changes',
      '- scene lighting',
      '## Forbidden Changes',
      '- identity drift',
    ].join('\n'),
    'docs/canon.md': [
      '# Canon',
      '## Common Rules',
      '- no legacy fallback',
      '## 鬼頭',
      '### Approved Visual Anchor',
      '- `public/images/characters/kitou/v2/anchor_reference.avif`',
      '### Accepted Visual Conditions',
      '- preserve facial identity',
    ].join('\n'),
    'docs/world.md': '- contemporary Japan',
    'docs/assets.md': 'asset manifest',
    'docs/kitou.md': '- 短髪\n- 黒髪\n- 痩せ型',
    'docs/kitou-anchor.md': '- 短髪を維持\n- Canon factsから再構築する',
  };
  const files = new Set(['public/global.webp']);
  if (includeApprovedAnchor) files.add('public/images/characters/kitou/v2/anchor_reference.avif');
  return new MemorySource(texts, files);
}

describe('replacement-pending Approved Visual Anchor', () => {
  it('parses replacement_pending without discarding the historical Approved Anchor from Canon', () => {
    expect(manifest('replacement_pending').subjects.kitou?.anchorGenerationStatus).toBe('replacement_pending');
  });

  it('prepares a replacement candidate without using the invalid Approved Anchor as a parent', async () => {
    const adapter = new CanonProjectAdapter(manifest('replacement_pending'), { source: source(false) });
    const result = await adapter.prepare({
      project_id: 'demo',
      asset_type: 'character_visual_anchor',
      subject_ids: ['kitou'],
      request_text: 'Prepare a replacement candidate.',
    });

    expect(result.reference_assets).toEqual([{ role: 'global_reference', path: 'public/global.webp' }]);
    expect(result.policy).toEqual({
      must_use_approved_anchor: false,
      must_not_chain_from_candidate: true,
      must_review_after_generation: true,
    });
    expect(result.prompt_package.subject_lock[0]).toContain('REPLACEMENT VISUAL ANCHOR CANDIDATE / NO VALID GENERATION PARENT');
    expect(result.prompt_package.subject_lock[0]).toContain('Canon history');
    expect(result.prompt_package.forbidden_changes.join('\n')).toContain('Do not silently fall back to an older generation');
  });

  it('fails closed for ordinary generations while replacement is pending', async () => {
    const adapter = new CanonProjectAdapter(manifest('replacement_pending'), { source: source(false) });
    await expect(adapter.prepare({
      project_id: 'demo',
      asset_type: 'character_portrait',
      subject_ids: ['kitou'],
      request_text: 'Render a portrait.',
    })).rejects.toMatchObject({ code: 'APPROVED_ANCHOR_REPLACEMENT_PENDING' });
  });

  it('keeps normal Approved Anchor direct-parent behavior unchanged', async () => {
    const adapter = new CanonProjectAdapter(manifest('active'), { source: source(true) });
    const result = await adapter.prepare({
      project_id: 'demo',
      asset_type: 'character_portrait',
      subject_ids: ['kitou'],
      request_text: 'Render a portrait.',
    });

    expect(result.reference_assets).toContainEqual({
      role: 'subject_anchor',
      subject_id: 'kitou',
      path: 'public/images/characters/kitou/v2/anchor_reference.avif',
    });
    expect(result.policy.must_use_approved_anchor).toBe(true);
  });
});
