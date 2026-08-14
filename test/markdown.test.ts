import { describe, expect, it } from 'vitest';

import { bulletsAfterLabel, section, subsection } from '../src/domain/markdown.js';

describe('section', () => {
  it('extracts a heading without a closing sequence (existing behavior)', () => {
    const markdown = '## Global Visual Style\nbody text\n\n## Next Section\nother\n';
    expect(section(markdown, 'Global Visual Style')).toBe('body text');
  });

  it('extracts the same heading when it uses an ATX closing sequence', () => {
    const markdown = '## Global Visual Style ##\nbody text\n\n## Next Section\nother\n';
    expect(section(markdown, 'Global Visual Style')).toBe('body text');
  });

  it('does not stop at a heading whose text merely differs', () => {
    const markdown = '## Global Visual Style ##\nbody text\n';
    expect(section(markdown, 'Different Heading')).toBe('');
  });

  it('still fails closed when the required material is actually missing', () => {
    const markdown = '## Some Other Section\nirrelevant\n';
    expect(section(markdown, 'Global Visual Style')).toBe('');
  });

  it('does not cross the next same-level heading, closing sequence or not', () => {
    const markdown = '## Heading ##\nfirst line\nsecond line\n## Next ##\nshould not be included\n';
    expect(section(markdown, 'Heading')).toBe('first line\nsecond line');
  });

  it('does not cross a higher-level heading', () => {
    const markdown = '## Heading ##\nfirst line\n# Top Level\nshould not be included\n';
    expect(section(markdown, 'Heading')).toBe('first line');
  });
});

describe('subsection', () => {
  it('recognizes a closing sequence at the subsection level', () => {
    const markdown = [
      '## Parent',
      '### Allowed Changes ###',
      '- expression',
      '- gaze',
      '### Forbidden Changes ###',
      '- identity',
    ].join('\n');
    expect(subsection(section(markdown, 'Parent'), 'Allowed Changes')).toBe('- expression\n- gaze');
  });
});

describe('bulletsAfterLabel', () => {
  it('reads bullets under a plain heading (existing behavior)', () => {
    const markdown = '### Allowed Changes\n- expression\n- gaze\n\n### Forbidden Changes\n- identity\n';
    expect(bulletsAfterLabel(markdown, 'Allowed Changes')).toEqual(['expression', 'gaze']);
  });

  it('reads bullets under a heading with an ATX closing sequence', () => {
    const markdown = '### Allowed Changes ###\n- expression\n- gaze\n\n### Forbidden Changes ###\n- identity\n';
    expect(bulletsAfterLabel(markdown, 'Allowed Changes')).toEqual(['expression', 'gaze']);
  });

  it('stops before the next label, closing sequence or not', () => {
    const markdown = '### Allowed Changes ###\n- expression\n### Forbidden Changes ###\n- identity\n';
    expect(bulletsAfterLabel(markdown, 'Allowed Changes')).toEqual(['expression']);
  });
});
