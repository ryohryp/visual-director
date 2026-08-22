import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('structured Approved Anchor review view', () => {
  it('renders distinct Canon constraint sections and approval metadata', async () => {
    const source = await readFile('src/web/project-pages.ts', 'utf8');

    for (const section of ['Subject Lock', 'Style Lock', 'Allowed Changes', 'Forbidden Changes', 'Avoid Block']) {
      expect(source).toContain(`<h2>${section}</h2>`);
    }
    expect(source).toContain('id="subject-id"');
    expect(source).toContain('id="approval-state"');
    expect(source).toContain('id="anchor-path"');
    expect(source).toContain("img.alt=(anchor.display_name||subject)+' — Approved Anchor'");
    expect(source).toContain('function renderConstraints(selector,value,emptyMessage)');
  });

  it('keeps optional lineage and constraints explicit when data is missing', async () => {
    const source = await readFile('src/web/project-pages.ts', 'utf8');

    expect(source).toContain('No subject lock is recorded.');
    expect(source).toContain('No style lock is recorded.');
    expect(source).toContain('No allowed changes are recorded.');
    expect(source).toContain('No forbidden changes are recorded.');
    expect(source).toContain('No avoid block is recorded.');
    expect(source).toContain("value||'Not recorded.'");
    expect(source).toContain('No managed assets are registered for this subject yet.');
    expect(source).toContain("lineage.global_reference?.path");
    expect(source).toContain("lineage.subject_anchor?.path");
  });

  it('uses a two-column desktop review and one-column 375px-safe layout', async () => {
    const source = await readFile('src/web/project-pages.ts', 'utf8');

    expect(source).toContain('grid-template-columns:minmax(300px,.85fr) minmax(0,1.15fr)');
    expect(source).toContain('@media(max-width:760px){.anchor-review{grid-template-columns:1fr');
    expect(source).toContain('.lineage-item{grid-template-columns:1fr');
  });
});
