import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bulletsAfterLabel, parseHeading, section, subsection } from '../src/domain/markdown.js';
import { BottomOfThirstAdapter } from '../src/projects/bottom-of-thirst/adapter.js';

describe('Markdown ATX heading parser', () => {
  describe('parseHeading', () => {
    it('parses standard ATX headings without closing #', () => {
      expect(parseHeading('## Global Visual Style')).toEqual({ level: 2, text: 'Global Visual Style' });
      expect(parseHeading('### Allowed Changes')).toEqual({ level: 3, text: 'Allowed Changes' });
      expect(parseHeading('# Top Level Heading')).toEqual({ level: 1, text: 'Top Level Heading' });
    });

    it('parses ATX headings with matching closing # sequence', () => {
      expect(parseHeading('## Global Visual Style ##')).toEqual({ level: 2, text: 'Global Visual Style' });
      expect(parseHeading('### Allowed Changes ###')).toEqual({ level: 3, text: 'Allowed Changes' });
      expect(parseHeading('### 変更してよいもの ###')).toEqual({ level: 3, text: '変更してよいもの' });
    });

    it('parses ATX headings with closing # sequence of different length and whitespace', () => {
      expect(parseHeading('## Global Visual Style #')).toEqual({ level: 2, text: 'Global Visual Style' });
      expect(parseHeading('## Global Visual Style ####')).toEqual({ level: 2, text: 'Global Visual Style' });
      expect(parseHeading('  ## Global Visual Style ##   ')).toEqual({ level: 2, text: 'Global Visual Style' });
      expect(parseHeading('### Allowed Changes #\t')).toEqual({ level: 3, text: 'Allowed Changes' });
    });

    it('handles headings with # characters within the title', () => {
      expect(parseHeading('## C# Programming ##')).toEqual({ level: 2, text: 'C# Programming' });
      expect(parseHeading('## C# ##')).toEqual({ level: 2, text: 'C#' });
      expect(parseHeading('## C#')).toEqual({ level: 2, text: 'C#' });
      expect(parseHeading('## #1 Issue ##')).toEqual({ level: 2, text: '#1 Issue' });
    });

    it('returns null for non-heading lines', () => {
      expect(parseHeading('Just a normal paragraph')).toBeNull();
      expect(parseHeading('- list item')).toBeNull();
      expect(parseHeading('#not_a_heading')).toBeNull();
      expect(parseHeading('####### Seven hashes (invalid)')).toBeNull();
      expect(parseHeading('')).toBeNull();
    });
  });

  describe('section and subsection extraction', () => {
    const sampleMarkdown = `
# Canon ##

## 共通ルール ##
- Always use an approved anchor.

## 相馬 健人 ##

### Approved Visual Anchor ###
- \`public/images/characters/souma/v2/default.avif\`

### 採用する視覚条件 ###
- 32歳の契約記者
- 色褪せた濃紺のジャケット

### Canonical state model ###
- Use one default anchor.

## 水上 沙耶 ##

### Approved Visual Anchor
- \`public/images/characters/saya/v2/default.avif\`

# World Direction
- dark and grounded
`;

    it('extracts section with closing # sequence', () => {
      const commonRules = section(sampleMarkdown, '共通ルール');
      expect(commonRules).toBe('- Always use an approved anchor.');

      const soumaSection = section(sampleMarkdown, '相馬 健人');
      expect(soumaSection).toContain('### Approved Visual Anchor ###');
      expect(soumaSection).toContain('32歳の契約記者');
      expect(soumaSection).not.toContain('水上 沙耶');
      expect(soumaSection).not.toContain('World Direction');
    });

    it('extracts subsection with closing # sequence', () => {
      const soumaSection = section(sampleMarkdown, '相馬 健人');
      const visualConditions = subsection(soumaSection, '採用する視覚条件');
      expect(visualConditions).toBe('- 32歳の契約記者\n- 色褪せた濃紺のジャケット');

      const anchor = subsection(soumaSection, 'Approved Visual Anchor');
      expect(anchor).toBe('- `public/images/characters/souma/v2/default.avif`');
    });

    it('does not cross same-level or higher-level boundaries', () => {
      const soumaSection = section(sampleMarkdown, '相馬 健人');
      expect(soumaSection).not.toContain('水上 沙耶');
      expect(soumaSection).not.toContain('共通ルール');
      expect(soumaSection).not.toContain('World Direction');

      const sayaSection = section(sampleMarkdown, '水上 沙耶');
      expect(sayaSection).toBe('### Approved Visual Anchor\n- `public/images/characters/saya/v2/default.avif`');
      expect(sayaSection).not.toContain('World Direction');
    });

    it('fails closed when section heading is not found or empty', () => {
      expect(section(sampleMarkdown, '存在しないキャラクター')).toBe('');
      expect(section(sampleMarkdown, '')).toBe('');
      expect(subsection(sampleMarkdown, '存在しないサブセクション')).toBe('');
    });
  });

  describe('bulletsAfterLabel', () => {
    const styleMarkdown = `
## Global Visual Style ##

### 変更してよいもの ###
- small facial expression
- gaze
- hand position

### 変更してはいけないもの ##
- face identity
- silhouette
`;

    it('extracts bullets after headings with closing #', () => {
      expect(bulletsAfterLabel(styleMarkdown, '変更してよいもの')).toEqual([
        'small facial expression',
        'gaze',
        'hand position',
      ]);
      expect(bulletsAfterLabel(styleMarkdown, '変更してはいけないもの')).toEqual([
        'face identity',
        'silhouette',
      ]);
    });

    it('extracts bullets after colon labels', () => {
      const colonMarkdown = `
変更してよいもの:
- expression
`;
      expect(bulletsAfterLabel(colonMarkdown, '変更してよいもの')).toEqual(['expression']);
    });

    it('fails closed when label is not found', () => {
      expect(bulletsAfterLabel(styleMarkdown, '存在しない項目')).toEqual([]);
    });
  });
});

describe('Generation Package preparation with closing # headings', () => {
  let fixtureRoot: string;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-director-closing-hash-'));
    await createFixtureWithClosingHashes(fixtureRoot);
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('prepares Generation Package when Canon files use closing # headings', async () => {
    const adapter = new BottomOfThirstAdapter({ repoPath: fixtureRoot });
    const result = await adapter.prepare({
      project_id: 'bottom-of-thirst',
      asset_type: 'event_cg',
      subject_ids: ['souma'],
      request_text: '地下の記録保管庫で古い記録を確認しているイベントCG',
    });

    expect(result.project_id).toBe('bottom-of-thirst');
    expect(result.prompt_package.style_lock).toBe('STYLE LOCK');
    expect(result.prompt_package.avoid_block).toEqual(['photorealism', 'anime']);
    expect(result.prompt_package.subject_lock[0]).toContain('相馬 健人');
    expect(result.prompt_package.subject_lock[0]).toContain('32歳の契約記者');
    expect(result.prompt_package.subject_lock[0]).toContain('色褪せた濃紺のジャケット');
    expect(result.prompt_package.allowed_changes).toEqual(['small facial expression', 'gaze', 'hand position']);
    expect(result.prompt_package.forbidden_changes).toContain('face identity');
    expect(result.prompt_package.forbidden_changes.join(' ')).toContain('Always use an approved anchor.');
    expect(result.reference_assets).toEqual([
      { role: 'global_reference', path: 'docs/visual/assets/global_visual_style_reference.webp' },
      { role: 'subject_anchor', subject_id: 'souma', path: 'public/images/characters/souma/v2/default.avif' },
    ]);
  });
});

async function createFixtureWithClosingHashes(root: string): Promise<void> {
  const files: Record<string, string> = {
    'docs/visual/GLOBAL_VISUAL_STYLE.md': `# Global Style #\n\n## Global Visual Style Lock ##\n\n\`\`\`text\nSTYLE LOCK\n\`\`\`\n\n## Fixed Avoid Block ##\n\n\`\`\`text\nAVOID: photorealism, anime\n\`\`\`\n\n## 既存キャラクター差分生成フロー ##\n\n### 変更してよいもの ###\n- small facial expression\n- gaze\n- hand position\n\n### 変更してはいけないもの ###\n- face identity\n`,
    'docs/visual/CHARACTER_VISUAL_CANON.md': `# Canon ##\n\n## 共通ルール ##\n- Always use an approved anchor.\n\n## 相馬 健人 ##\n\n### Approved Visual Anchor ###\n- \`public/images/characters/souma/v2/default.avif\`\n\n### 採用する視覚条件 ###\n- 32歳の契約記者\n- 色褪せた濃紺のジャケット\n\n### Canonical state model ###\n- Use one default anchor.\n\n## 水上 沙耶 ##\n\n### Approved Visual Anchor ###\n- \`public/images/characters/saya/v2/default.avif\`\n`,
    'docs/WORLD_DIRECTION.md': '# World Direction #\n\n- grounded and observational\n- ordinary light\n',
    'docs/characters/soma.md': '# Soma #\n\n- contract reporter\n- careful with records\n',
    'docs/visual/assets/README.md': '# Assets #\n',
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }

  for (const relativePath of [
    'docs/visual/assets/global_visual_style_reference.webp',
    'public/images/characters/souma/v2/default.avif',
  ]) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from('fixture'));
  }
}
