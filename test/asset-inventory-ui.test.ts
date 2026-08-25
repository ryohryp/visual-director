import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Script } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { projectCollectionHandler } from '../src/web/project-collection.js';

describe('Project Visual Asset Inventory UI', () => {
  it('shows the required inventory summary on the canonical project dashboard', async () => {
    const source = await readFile('src/web/project-pages.ts', 'utf8');

    expect(source).toContain('<h2>Visual Asset Inventory</h2>');
    expect(source).toContain("['Required',inventory.summary.total_required]");
    expect(source).toContain("['Ready',inventory.summary.ready]");
    expect(source).toContain("['Review required',inventory.summary.review_required]");
    expect(source).toContain("['Missing',inventory.summary.missing]");
    expect(source).toContain("['Problems',inventory.summary.broken]");
    expect(source).toContain("['Unmanaged',inventory.summary.unmanaged]");
    expect(source).toContain('No .visual-director/asset-plan.json exists yet.');
  });

  it('filters the canonical Assets view by derived state and asset type', async () => {
    const source = await readFile('src/web/project-collection.ts', 'utf8');

    for (const state of ['REQUIRED', 'MISSING', 'REVIEW_REQUIRED', 'READY', 'BROKEN', 'UNMANAGED']) {
      expect(source).toContain(`'${state}'`);
    }
    expect(source).toContain('function filteredInventory(o)');
    expect(source).toContain("return a.kind==='required'&&a.required&&a.status===activeInventoryFilter");
    expect(source).toContain('o.inventory.assets.filter');
    expect(source).toContain('a.asset_type===type');
    expect(source).toContain('a.current_lifecycle===lifecycle');
    expect(source).toContain('badge.review_required');
    expect(source).toContain('badge.broken');
    expect(source).toContain('badge.unmanaged');
    expect(source).toContain("a.required?'required':'optional'");
  });

  it('offers generation preparation only for MISSING required assets', async () => {
    const source = await readFile('src/web/project-collection.ts', 'utf8');

    expect(source).toContain("function canPrepareGeneration(a){return a.kind==='required'&&a.required&&a.status==='MISSING'");
    expect(source).toContain("'Prepare Generation'");
    expect(source).toContain("'/required-assets/'");
    expect(source).toContain("method:'POST'");
    expect(source).toContain('Resolving Required Asset definition, Canon, Grand Design, and Approved Anchors');
    expect(source).toContain('generation_input:data.generation_input');
    expect(source).toContain('policy:data.generation_package?.policy');
  });

  it('renders required definition, candidate/production previews, problems, and workflow lineage in Asset Detail', async () => {
    const source = await readFile('src/web/project-collection.ts', 'utf8');

    expect(source).toContain('<h3>Required Asset definition</h3>');
    expect(source).toContain("addKv(required,'Usage',definition.usage)");
    expect(source).toContain("addKv(required,'Production path',definition.production_path)");
    expect(source).toContain("['Candidate',a.candidate_path]");
    expect(source).toContain("['Production',a.registered_path");
    expect(source).toContain('for(const issue of a.issues||[])');
    expect(source).toContain('for(const item of a.workflow_assets||[])');
    expect(source).toContain("addKv(generation,'Fingerprint',job.generation_package_fingerprint)");
    expect(source).toContain('No .visual-director/asset-plan.json exists yet. Showing repository workflow history only.');
  });

  it('emits syntactically valid client JavaScript for the inventory page', () => {
    let html = '';
    const response = {
      statusCode: 0,
      setHeader() {},
      end(value?: unknown) { html = String(value ?? ''); },
    } as unknown as ServerResponse;
    projectCollectionHandler({ method: 'GET' } as IncomingMessage, response);
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? '';

    expect(script).toBeTruthy();
    expect(() => new Script(script)).not.toThrow();
  });
});
