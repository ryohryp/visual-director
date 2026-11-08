import { describe, expect, it } from 'vitest';

import { VisualDirectorError } from '../src/domain/types.js';
import { CanonProjectAdapter } from '../src/projects/canon/adapter.js';
import { parseRepositoryCanonManifest } from '../src/projects/canon/repository-manifest.js';
import type { RepositorySource } from '../src/projects/repository-source.js';

const anchor = 'public/images/hero/v3/default.png';
const legacy = 'public/images/hero/v2/default.png';
const canon = `# Canon\n\n## Approved characters\n- **Hero**: plain clothes, short black hair, no armor\n\n## Forbidden visual changes\n\n1. Never replace the v3 identity with a legacy asset.\n`;

function adapter(options: { canon?: string; anchorPath?: string; canonHeading?: string; exists?: boolean } = {}) {
  const definition = parseRepositoryCanonManifest({
    version: 1, project_id: 'game-v3',
    documents: { globalReference: null },
    labels: { commonRulesHeading: 'Forbidden visual changes' },
    subjects: {
      hero: {
        display_name: 'Hero', character_file: 'characters/hero.md', canon_facts_label: 'Hero',
        approved_anchor_path: options.anchorPath ?? anchor,
        ...(options.canonHeading ? { canon_heading: options.canonHeading } : {}),
      },
    },
  });
  const files = new Map([
    [definition.documents.characterCanon, options.canon ?? canon],
    [definition.documents.globalStyle, '# Style\n\n```text\nSTYLE LOCK\n```\n\n### Fixed Avoid Block\n\n```text\nAVOID: armor\n```'],
    [definition.documents.worldDirection, '# World\n\n- Ordinary light'],
    [definition.documents.assetManifest, '# Assets\n\nApproved images only'],
    ['characters/hero.md', '# Hero\n\n- Hero is 25 years old'],
  ]);
  const source: RepositorySource = {
    kind: 'local',
    checkAccess: async () => {},
    readText: async (file) => {
      const content = files.get(file);
      if (content === undefined) throw new Error(`Unexpected file: ${file}`);
      return content;
    },
    ensureFile: async (file) => {
      if (file !== anchor || options.exists === false) throw new VisualDirectorError('REFERENCE_NOT_FOUND', `Missing approved file: ${file}`);
    },
    fileExists: async (file) => file === anchor && options.exists !== false,
  };
  return new CanonProjectAdapter(definition, { source });
}

const request = { project_id: 'game-v3', asset_type: 'character_portrait', subject_ids: ['hero'], request_text: 'Draw Hero' };

describe('repository-owned Approved Anchor paths', () => {
  it('uses the explicit approved v3 path, preserves Canon invariants, and lists the same Anchor', async () => {
    const project = adapter();
    const prepared = await project.prepare(request);
    expect(prepared.reference_assets).toContainEqual({ role: 'subject_anchor', subject_id: 'hero', path: anchor });
    expect(prepared.prompt_package.subject_lock[0]).toContain('plain clothes, short black hair, no armor');
    expect(prepared.prompt_package.forbidden_changes).toContain('Never replace the v3 identity with a legacy asset.');
    expect(prepared.policy.must_use_approved_anchor).toBe(true);
    const overview = await project.getVisualOverview();
    expect(overview.approved_anchors).toContainEqual({ subject_id: 'hero', display_name: 'Hero', asset_type: 'character_visual_anchor', path: anchor, status: 'approved' });
  });

  it('fails closed when the v3 Canon invariant is missing', async () => {
    const project = adapter({ canon: '# Canon\n- **Another**: a different character' });
    await expect(project.prepare(request)).rejects.toMatchObject({ code: 'CHARACTER_CANON_INVARIANT_INVALID' });
    await expect(project.getVisualOverview()).rejects.toMatchObject({ code: 'CHARACTER_CANON_INVARIANT_INVALID' });
  });

  it('fails closed when the v3 Canon invariant is ambiguous', async () => {
    const project = adapter({ canon: `${canon}\n- **Hero**: conflicting hair color` });
    await expect(project.prepare(request)).rejects.toMatchObject({ code: 'CHARACTER_CANON_INVARIANT_INVALID' });
  });

  it('does not fall back to a retired Anchor if the v3 file is absent', async () => {
    const project = adapter({ exists: false });
    await expect(project.prepare(request)).rejects.toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
  });

  it('rejects conflicting explicit and legacy Anchor paths', async () => {
    const project = adapter({ canonHeading: 'Hero', canon: `${canon}\n## Hero\n\n### Approved Visual Anchor\n- \`${legacy}\`\n` });
    await expect(project.prepare(request)).rejects.toMatchObject({ code: 'APPROVED_ANCHOR_CONFLICT' });
    await expect(project.getVisualOverview()).rejects.toMatchObject({ code: 'APPROVED_ANCHOR_CONFLICT' });
  });
});
