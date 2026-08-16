import { describe, expect, it } from 'vitest';

import { bulletsAfterLabel, parseHeading, section, subsection } from '../src/domain/markdown.js';

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

## Common Rules ##
- Always use an approved anchor.

## Hero ##

### Approved Visual Anchor ###
- \`assets/hero/default.avif\`

### Accepted Visual Conditions ###
- grounded protagonist
- dark jacket

### Canonical state model ###
- Use one default anchor.

## Rival ##

### Approved Visual Anchor
- \`assets/rival/default.avif\`

# World Direction
- dark and grounded
`;

    it('extracts section with closing # sequence', () => {
      const commonRules = section(sampleMarkdown, 'Common Rules');
      expect(commonRules).toBe('- Always use an approved anchor.');

      const heroSection = section(sampleMarkdown, 'Hero');
      expect(heroSection).toContain('### Approved Visual Anchor ###');
      expect(heroSection).toContain('grounded protagonist');
      expect(heroSection).not.toContain('Rival');
      expect(heroSection).not.toContain('World Direction');
    });

    it('extracts subsection with closing # sequence', () => {
      const heroSection = section(sampleMarkdown, 'Hero');
      expect(subsection(heroSection, 'Accepted Visual Conditions')).toBe('- grounded protagonist\n- dark jacket');
      expect(subsection(heroSection, 'Approved Visual Anchor')).toBe('- `assets/hero/default.avif`');
    });

    it('does not cross same-level or higher-level boundaries', () => {
      const heroSection = section(sampleMarkdown, 'Hero');
      expect(heroSection).not.toContain('Rival');
      expect(heroSection).not.toContain('Common Rules');
      expect(heroSection).not.toContain('World Direction');

      const rivalSection = section(sampleMarkdown, 'Rival');
      expect(rivalSection).toBe('### Approved Visual Anchor\n- `assets/rival/default.avif`');
      expect(rivalSection).not.toContain('World Direction');
    });

    it('fails closed when section heading is not found or empty', () => {
      expect(section(sampleMarkdown, 'missing')).toBe('');
      expect(section(sampleMarkdown, '')).toBe('');
      expect(subsection(sampleMarkdown, 'missing')).toBe('');
    });
  });

  describe('bulletsAfterLabel', () => {
    const styleMarkdown = `
## Global Visual Style ##

### Allowed Changes ###
- small facial expression
- gaze
- hand position

### Forbidden Changes ##
- face identity
- silhouette
`;

    it('extracts bullets after headings with closing #', () => {
      expect(bulletsAfterLabel(styleMarkdown, 'Allowed Changes')).toEqual([
        'small facial expression',
        'gaze',
        'hand position',
      ]);
      expect(bulletsAfterLabel(styleMarkdown, 'Forbidden Changes')).toEqual(['face identity', 'silhouette']);
    });

    it('extracts bullets after colon labels', () => {
      expect(bulletsAfterLabel('Allowed Changes:\n- expression\n', 'Allowed Changes')).toEqual(['expression']);
    });

    it('fails closed when label is not found', () => {
      expect(bulletsAfterLabel(styleMarkdown, 'Missing Label')).toEqual([]);
    });
  });
});
