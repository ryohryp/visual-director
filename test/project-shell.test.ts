import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  PROJECT_IMAGE_PREVIEW_CLIENT_SCRIPT,
  PROJECT_IMAGE_PREVIEW_STYLES,
  PROJECT_SHELL_CLIENT_SCRIPT,
  PROJECT_SHELL_STYLES,
  projectShellMarkup,
} from '../src/web/project-shell.js';

describe('shared project workspace shell', () => {
  it('renders the project identity region and accessible navigation mount point', () => {
    const markup = projectShellMarkup('Approved Anchor');

    expect(markup).toContain('class="project-shell"');
    expect(markup).toContain('<nav class="project-breadcrumb" aria-label="Breadcrumb">');
    expect(markup).toContain('id="project-context"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('id="nav" class="nav project-nav"');
    expect(markup).toContain('aria-label="Project navigation"');
    expect(markup).toContain('aria-label="Back to Projects"');
    expect(markup).toContain('← Projects');
  });

  it('creates project-scoped links and marks the active page', () => {
    expect(PROJECT_SHELL_CLIENT_SCRIPT).toContain("root='/projects/'+encodeURIComponent(project)");
    expect(PROJECT_SHELL_CLIENT_SCRIPT).toContain("setAttribute('aria-current','page')");
    expect(PROJECT_SHELL_CLIENT_SCRIPT).toContain("['Global Canon','canon']");
    expect(PROJECT_SHELL_CLIENT_SCRIPT).toContain("current==='anchor-detail'?'anchors':current");
    expect(PROJECT_SHELL_CLIENT_SCRIPT).toContain("['Assets','assets']");
    expect(PROJECT_SHELL_CLIENT_SCRIPT).toContain('setProjectContext(project)');
  });

  it('keeps the shared navigation usable when the project identity is long or the viewport is narrow', () => {
    expect(PROJECT_SHELL_STYLES).toContain('overflow-wrap:anywhere');
    expect(PROJECT_SHELL_STYLES).toContain('flex-wrap:wrap');
    expect(PROJECT_SHELL_STYLES).toContain('@media(max-width:640px)');
  });

  it('defines a full-frame preview policy and explicit failure treatment', () => {
    expect(PROJECT_IMAGE_PREVIEW_STYLES).toContain('object-fit:contain');
    expect(PROJECT_IMAGE_PREVIEW_STYLES).toContain('aspect-ratio:4/3');
    expect(PROJECT_IMAGE_PREVIEW_STYLES).toContain('.preview-fallback');
    expect(PROJECT_IMAGE_PREVIEW_CLIENT_SCRIPT).toContain("img.alt=alt||'Approved Anchor preview'");
    expect(PROJECT_IMAGE_PREVIEW_CLIENT_SCRIPT).toContain("fail('Preview unavailable')");
    expect(PROJECT_IMAGE_PREVIEW_CLIENT_SCRIPT).toContain("fail('Preview unavailable: transparent asset')");
    expect(PROJECT_IMAGE_PREVIEW_CLIENT_SCRIPT).toContain('preview-path');
  });

  it('is used by every project-scoped page family', async () => {
    const sources = await Promise.all([
      readFile('src/web/project-pages.ts', 'utf8'),
      readFile('src/web/project-collection.ts', 'utf8'),
    ]);

    for (const source of sources) {
      expect(source).toContain('projectShellMarkup');
      expect(source).toContain('PROJECT_SHELL_CLIENT_SCRIPT');
    }
  });
});
