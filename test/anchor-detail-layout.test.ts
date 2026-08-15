import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('anchor detail image layout', () => {
  it('preserves the full approved anchor image instead of cropping it to card aspect ratio', async () => {
    const source = await readFile('src/web/project-pages.ts', 'utf8');

    expect(source).toContain("img.style.height='auto'");
    expect(source).toContain("img.style.aspectRatio='auto'");
    expect(source).toContain("img.style.objectFit='contain'");
  });
});
