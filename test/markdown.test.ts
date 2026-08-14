import { describe, expect, it } from 'vitest';

import { section, subsection } from '../src/domain/markdown.js';

describe('Markdown Canon heading extraction', () => {
  it('recognizes equivalent ATX headings with and without closing sequences', () => {
    expect(section('## Global Visual Style\nstyle lock', 'Global Visual Style')).toBe('style lock');
    expect(section('## Global Visual Style ##\nstyle lock', 'Global Visual Style')).toBe('style lock');
  });

  it('recognizes closing sequences on subsections without crossing heading boundaries', () => {
    const markdown = `## Character One ##
### Approved Visual Anchor ###
- \`assets/one.avif\`

### Accepted Visual Conditions ###
- blue coat

## Character Two ##
### Approved Visual Anchor ###
- \`assets/two.avif\``;

    const characterOne = section(markdown, 'Character One');

    expect(characterOne).toContain('assets/one.avif');
    expect(characterOne).toContain('blue coat');
    expect(characterOne).not.toContain('Character Two');
    expect(subsection(characterOne, 'Approved Visual Anchor')).toBe('- `assets/one.avif`');
    expect(subsection(characterOne, 'Approved Visual Anchor')).not.toContain('blue coat');
  });

  it('does not treat a different heading name as a match', () => {
    expect(section('## Global Visual Styles ##\nstyle lock', 'Global Visual Style')).toBe('');
  });
});
