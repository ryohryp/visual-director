import { describe, expect, it } from 'vitest';

import { bulletsAfterLabel, parseHeading, section, subsection } from '../src/domain/markdown.js';

describe('parseHeading', () => {
  it('parses standard ATX headings without closing sequence', () => {
    expect(parseHeading('# Title')).toEqual({ level: 1, text: 'Title' });
    expect(parseHeading('## Global Visual Style')).toEqual({ level: 2, text: 'Global Visual Style' });
    expect(parseHeading('### Allowed Changes')).toEqual({ level: 3, text: 'Allowed Changes' });
  });

  it('parses ATX headings with closing hashes', () => {
    expect(parseHeading('## Global Visual Style ##')).toEqual({ level: 2, text: 'Global Visual Style' });
    expect(parseHeading('### Allowed Changes ###')).toEqual({ level: 3, text: 'Allowed Changes' });
    expect(parseHeading('## Asymmetric Closing ###')).toEqual({ level: 2, text: 'Asymmetric Closing' });
    expect(parseHeading('## Single Hash Closing #')).toEqual({ level: 2, text: 'Single Hash Closing' });
    expect(parseHeading('# Top Level #')).toEqual({ level: 1, text: 'Top Level' });
  });

  it('handles surrounding whitespace and indentation', () => {
    expect(parseHeading('   ## Indented Heading ##   ')).toEqual({ level: 2, text: 'Indented Heading' });
    expect(parseHeading('##   Extra Spaced Content   ##')).toEqual({ level: 2, text: 'Extra Spaced Content' });
  });

  it('preserves hash characters inside text when not preceded by space', () => {
    expect(parseHeading('## C#')).toEqual({ level: 2, text: 'C#' });
    expect(parseHeading('## C# ##')).toEqual({ level: 2, text: 'C#' });
    expect(parseHeading('## Item #1 ##')).toEqual({ level: 2, text: 'Item #1' });
  });

  it('returns null for non-heading lines', () => {
    expect(parseHeading('Just a regular paragraph')).toBeNull();
    expect(parseHeading('#NotAHeading')).toBeNull();
    expect(parseHeading('####### Too many hashes')).toBeNull();
    expect(parseHeading('- list item')).toBeNull();
  });
});

describe('section and subsection extraction', () => {
  const markdownWithClosingHashes = `
# Document Title #

## Global Visual Style ##
Here is the global visual style content.

### Style Details ###
- Detail 1
- Detail 2

### Avoidances ###
- Avoid glossy

## Character Canon ##
Character details go here.

### Approved Visual Anchor ###
- \`path/to/anchor.webp\`

### Accepted Conditions ###
- Condition A
- Condition B

# Appendices #
Appendix content.
`;

  it('extracts section with closing hashes', () => {
    const result = section(markdownWithClosingHashes, 'Global Visual Style');
    expect(result).toContain('Here is the global visual style content.');
    expect(result).toContain('### Style Details ###');
    expect(result).toContain('### Avoidances ###');
    expect(result).not.toContain('Character Canon');
  });

  it('extracts subsection with closing hashes', () => {
    const canonSection = section(markdownWithClosingHashes, 'Character Canon');
    const anchor = subsection(canonSection, 'Approved Visual Anchor');
    expect(anchor).toBe('- `path/to/anchor.webp`');

    const accepted = subsection(canonSection, 'Accepted Conditions');
    expect(accepted).toBe('- Condition A\n- Condition B');
  });

  it('does not leak across same or higher level heading boundaries', () => {
    const result = section(markdownWithClosingHashes, 'Character Canon');
    expect(result).toContain('Character details go here.');
    expect(result).toContain('path/to/anchor.webp');
    expect(result).not.toContain('Appendices');
    expect(result).not.toContain('Appendix content.');
  });

  it('preserves fail-closed behavior on mismatched heading or level', () => {
    expect(section(markdownWithClosingHashes, 'Nonexistent Section')).toBe('');
    // Searching at level 2 for a level 3 heading should return empty
    expect(section(markdownWithClosingHashes, 'Approved Visual Anchor')).toBe('');
    // Searching at level 3 for a level 2 heading should return empty
    expect(subsection(markdownWithClosingHashes, 'Global Visual Style')).toBe('');
  });
});

describe('bulletsAfterLabel', () => {
  it('extracts bullets after headings with closing hashes', () => {
    const markdown = `
## Style Guide ##

### 変更してよいもの ###
- small facial expression
- gaze
- hand position

### 変更してはいけないもの ###
- face identity
`;
    expect(bulletsAfterLabel(markdown, '変更してよいもの')).toEqual([
      'small facial expression',
      'gaze',
      'hand position',
    ]);
    expect(bulletsAfterLabel(markdown, '変更してはいけないもの')).toEqual(['face identity']);
  });

  it('extracts bullets after label colon format or standard headings', () => {
    const markdownColon = `
Allowed Changes:
- expression
- pose

Forbidden Changes:
- identity
`;
    expect(bulletsAfterLabel(markdownColon, 'Allowed Changes')).toEqual(['expression', 'pose']);
    expect(bulletsAfterLabel(markdownColon, 'Forbidden Changes')).toEqual(['identity']);
  });
});
