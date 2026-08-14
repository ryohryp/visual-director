import { describe, expect, it } from 'vitest';

import { bulletsAfterLabel, section, subsection } from '../src/domain/markdown.js';

describe('ATX heading extraction', () => {
  it('continues to extract headings without a closing sequence', () => {
    expect(section('## Heading\nexpected', 'Heading')).toBe('expected');
    expect(subsection('### Subheading\nexpected', 'Subheading')).toBe('expected');
  });

  it('recognizes matching section and subsection headings with closing sequences', () => {
    expect(section('## Heading ##\nsection content', 'Heading')).toBe('section content');
    expect(subsection('### Subheading ###\nsubsection content', 'Subheading')).toBe('subsection content');
    expect(bulletsAfterLabel('### Allowed Changes ###\n- expression', 'Allowed Changes')).toEqual(['expression']);
  });

  it('does not cross same-level or higher-level heading boundaries', () => {
    const markdown = [
      '## Target ##',
      'target content',
      '### Nested ###',
      'nested content',
      '## Sibling ##',
      'sibling content',
      '# Higher ##',
      'higher content',
    ].join('\n');

    expect(section(markdown, 'Target')).toBe('target content\n### Nested ###\nnested content');
    expect(section(markdown, 'Sibling')).toBe('sibling content');
  });
});
