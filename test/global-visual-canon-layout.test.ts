import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('global visual canon workspace', () => {
  it('exposes the Canon as the root visual authority and preserves the full reference image', async () => {
    const source = await readFile('src/web/project-pages.ts', 'utf8');

    expect(source).toContain('Global Visual Canon');
    expect(source).toContain('ROOT CANON');
    expect(source).toContain('Visual inheritance');
    expect(source).toContain("q('#reference').src=asset(canon.asset_path)");
    expect(source).toContain('object-fit:contain');
  });

  it('links the project navigation to the Canon management view', async () => {
    const source = await readFile('src/web/project-pages.ts', 'utf8');
    const shell = await readFile('src/web/project-shell.ts', 'utf8');
    const routes = await readFile('vercel.json', 'utf8');
    const workspace = await readFile('api/workspace.ts', 'utf8');

    expect(shell).toContain("['Global Canon','canon']");
    expect(source).toContain("setupProjectShell(project,'canon')");
    expect(routes).toContain('^/projects/([^/]+)/canon/?$');
    expect(workspace).toContain("view === 'canon'");
  });
});
