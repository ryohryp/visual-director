import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('canonical project workflow UI', () => {
  it('keeps collection requests project-scoped without the legacy project fallback', async () => {
    const source = await readFile('src/web/project-collection.ts', 'utf8');

    expect(source).toContain("root='/projects/'+encodeURIComponent(project)");
    expect(source).toContain("'/api/projects/'+encodeURIComponent(project)+'/asset?path='");
    expect(source).toContain("'/api/projects/'+encodeURIComponent(project)+'/overview'");
    expect(source).toContain("Unknown project_id: '+project");
    expect(source).not.toContain("const project='bottom-of-thirst'");
    expect(source).not.toContain('/api/overview?project_id=');
    expect(source).not.toContain('/api/asset?project_id=');
  });

  it('restores asset filters, lifecycle state, detail metadata, lineage, and explicit empty workflow state', async () => {
    const source = await readFile('src/web/project-collection.ts', 'utf8');

    expect(source).toContain('id="subject"');
    expect(source).toContain('id="type"');
    expect(source).toContain('id="lifecycle"');
    expect(source).toContain('badge.candidate');
    expect(source).toContain('badge.approved,.badge.registered');
    expect(source).toContain('badge.rejected,.badge.failed');
    expect(source).toContain('badge.superseded');
    expect(source).toContain('function showDetail(o,a)');
    expect(source).toContain("addKv(meta,'Source job',a.source_job_id)");
    expect(source).toContain("addKv(generation,'Generator',a.generator||job?.generator)");
    expect(source).toContain("addKv(generation,'Fingerprint',a.generation_package_fingerprint||job?.generation_package_fingerprint)");
    expect(source).toContain('const paths=a.reference_paths||[]');
    expect(source).toContain('No .visual-director/asset-index.json exists yet. No generation history is invented.');
    expect(source).toContain('No assets match the current filters.');
  });

  it('shows detailed Generation Job metadata and failed errors', async () => {
    const source = await readFile('src/web/project-collection.ts', 'utf8');

    expect(source).toContain("job.request_text||job.job_id");
    expect(source).toContain("(job.subject_ids||[]).join(', ')");
    expect(source).toContain('job.generator');
    expect(source).toContain('job.generation_package_fingerprint');
    expect(source).toContain('if(job.error)');
    expect(source).toContain("job.status==='failed'");
  });

  it('routes the canonical workspace collection view through the restored UI module', async () => {
    const workspace = await readFile('api/workspace.ts', 'utf8');

    expect(workspace).toContain("import { projectCollectionHandler } from '../src/web/project-collection.js';");
    expect(workspace).toContain("if (view === 'collection') return projectCollectionHandler(req, res);");
  });
});
