import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('approved anchor gallery previews', () => {
  it('uses the shared full-frame preview and meaningful subject alt text in each gallery', async () => {
    const [dashboard, collection] = await Promise.all([
      readFile('src/web/project-pages.ts', 'utf8'),
      readFile('src/web/project-collection.ts', 'utf8'),
    ]);

    expect(dashboard).toContain('createImagePreview(asset(a.path),a.path,name)');
    expect(dashboard).toContain('createImagePreview(asset(a.path),a.path,name),el(\'span\'');
    expect(collection).toContain('createImagePreview(assetUrl(a.path),a.path,name)');
    expect(collection).toContain('${PROJECT_IMAGE_PREVIEW_CLIENT_SCRIPT}');
  });

  it('keeps a uniform 4:3 tile while fitting the complete image and naming failures', async () => {
    const shell = await readFile('src/web/project-shell.ts', 'utf8');

    expect(shell).toContain('.preview-frame');
    expect(shell).toContain('aspect-ratio:4/3');
    expect(shell).toContain('object-fit:contain');
    expect(shell).toContain('transparent asset');
    expect(shell).toContain('No repository image path recorded.');
  });

  it('uses a two-column collection at narrow widths without removing the preview policy', async () => {
    const source = await readFile('src/web/project-collection.ts', 'utf8');

    expect(source).toContain('@media(max-width:700px)');
    expect(source).toContain('.gallery{grid-template-columns:repeat(2,minmax(0,1fr))}');
    expect(source).toContain('${PROJECT_IMAGE_PREVIEW_STYLES}');
  });
});
