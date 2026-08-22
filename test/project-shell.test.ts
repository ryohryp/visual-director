import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  PROJECT_SHELL_CLIENT_SCRIPT,
  projectShellMarkup,
} from '../src/web/project-shell.js';

describe('shared project workspace shell', () => {
  it('renders the project identity region and accessible navigation mount point', () => {
    const markup = projectShellMarkup('Approved Anchor');

    expect(markup).toContain('class="project-shell"');
    expect(markup).toContain('id="project-context"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('id="nav" class="nav project-nav"');
    expect(markup).toContain('aria-label="Project navigation"');
    expect(markup).toContain('← Projects');
  });

  it('creates project-scoped links and marks the active page', () => {
    expect(PROJECT_SHELL_CLIENT_SCRIPT).toContain("root='/projects/'+encodeURIComponent(project)");
    expect(PROJECT_SHELL_CLIENT_SCRIPT).toContain("setAttribute('aria-current','page')");
    expect(PROJECT_SHELL_CLIENT_SCRIPT).toContain("['Global Canon','canon']");
    expect(PROJECT_SHELL_CLIENT_SCRIPT).toContain('setProjectContext(project)');
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
