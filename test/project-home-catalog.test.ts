import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('project home catalog rendering', () => {
  it('renders only catalog-derived project fields before a project is opened', async () => {
    const source = await readFile('src/web/home.ts', 'utf8');

    expect(source).toContain('p.display_name');
    expect(source).toContain('p.repository');
    expect(source).toContain('p.ref');
    expect(source).toContain('p.adapter_type');
    expect(source).not.toContain('p.thumbnail');
    expect(source).not.toContain('p.repository_status');
    expect(source).not.toContain('p.diagnostics');
    expect(source).not.toContain('p.anchors');
    expect(source).not.toContain('p.candidates');
    expect(source).not.toContain('p.jobs');
    expect(source).not.toContain('p.failed_jobs');
    expect(source).not.toContain('/api/projects/'+encodeURIComponent(id)+\'/asset');
  });
});
