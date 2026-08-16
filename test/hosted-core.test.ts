import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createVisualDirectorCore } from '../src/core/visual-director.js';

const previous = {
  token: process.env.VISUAL_DIRECTOR_GITHUB_TOKEN,
  repo: process.env.VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REPO,
  ref: process.env.VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REF,
  hostedReadOnly: process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY,
  local: process.env.BOTTOM_OF_THIRST_REPO_PATH,
};

beforeEach(() => {
  process.env.VISUAL_DIRECTOR_GITHUB_TOKEN = 'test-token';
  process.env.VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REPO = 'ryohryp/---The-Bottom-of-Thirst';
  process.env.VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REF = 'main';
  process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY = '1';
  delete process.env.BOTTOM_OF_THIRST_REPO_PATH;
});

afterEach(() => {
  restore('VISUAL_DIRECTOR_GITHUB_TOKEN', previous.token);
  restore('VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REPO', previous.repo);
  restore('VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REF', previous.ref);
  restore('VISUAL_DIRECTOR_HOSTED_READ_ONLY', previous.hostedReadOnly);
  restore('BOTTOM_OF_THIRST_REPO_PATH', previous.local);
});

const textFiles: Record<string, string> = {
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
      },
    },
  }),
  'docs/visual/GLOBAL_VISUAL_STYLE.md': `# Global Style\n\n## Global Visual Style Lock\n\n\`\`\`text\nGROUNDED SEMI-REALISTIC STYLE\n\`\`\`\n\n## Fixed Avoid Block\n\n\`\`\`text\nAVOID: photorealism, anime\n\`\`\`\n\n### 変更してよいもの\n- small expression\n\n### 変更してはいけないもの\n- face identity\n`,
  'docs/visual/CHARACTER_VISUAL_CANON.md': `# Canon\n\n## 共通ルール\n- Approved Anchorを不変の基準にする\n\n## 神野 恭介\n\n### Approved Visual Anchor\n- \`public/images/characters/kamino_kyosuke/v2/default.avif\`\n- \`public/images/characters/kamino_kyosuke/v2/default.webp\`\n\n### 採用する視覚条件\n- 24歳の日本人男性\n- 動画配信者\n- ジンバルを使う\n\n### Canonical state model\n- default is authoritative\n`,
  'docs/WORLD_DIRECTION.md': '# World\n\n- grounded and observational\n- ordinary light\n',
  'docs/characters/kyosuke.md': '# 神野 恭介\n\n- 24歳\n- 動画配信者\n- ジンバルを使う\n',
  'docs/visual/assets/README.md': '# Assets\n- global style reference\n',
};

const binaryFiles = new Set([
  'docs/visual/assets/global_visual_style_reference.webp',
  'public/images/characters/kamino_kyosuke/v2/default.avif',
  'public/images/characters/kamino_kyosuke/v2/default.webp',
]);

describe('hosted Visual Director Core', () => {
  it('prepares Kamino from GitHub without local repository binding', async () => {
    const core = createVisualDirectorCore({ fetchImpl: githubFixtureFetch });
    const result = await core.prepareGeneration({
      project_id: 'bottom-of-thirst',
      asset_type: 'character_visual_anchor',
      subject_ids: ['kamino_kyosuke'],
      request_text: 'Approved Visual Anchorを正本としてGeneration Packageを取得する',
    });

    expect(result.reference_assets).toContainEqual({
      role: 'subject_anchor',
      subject_id: 'kamino_kyosuke',
      path: 'public/images/characters/kamino_kyosuke/v2/default.avif',
    });
    expect(result.policy.must_use_approved_anchor).toBe(true);
    expect(result.prompt_package.subject_lock.join('\n')).toContain('default.avif');
  });

  it('keeps adopt_anchor disabled when hosted read-only mode is configured', async () => {
    const core = createVisualDirectorCore({ fetchImpl: githubFixtureFetch });
    await expect(core.adoptAnchor({
      project_id: 'bottom-of-thirst',
      subject_id: 'kamino_kyosuke',
      candidate_path: 'candidate.png',
      approval: 'approve',
    })).rejects.toMatchObject({ code: 'HOSTED_WRITE_DISABLED' });
  });
});

async function githubFixtureFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input));
  const marker = '/contents/';
  const index = url.pathname.indexOf(marker);
  const relativePath = index >= 0 ? url.pathname.slice(index + marker.length).split('/').map(decodeURIComponent).join('/') : '';
  if (relativePath in textFiles) {
    return new Response(JSON.stringify({
      type: 'file',
      encoding: 'base64',
      content: Buffer.from(textFiles[relativePath] as string).toString('base64'),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (binaryFiles.has(relativePath)) {
    return new Response(JSON.stringify({ type: 'file', encoding: 'base64', content: 'AA==' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('{}', { status: 404 });
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
