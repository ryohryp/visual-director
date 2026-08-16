import { readdir, readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('v0.4 project-scoped routing', () => {
  it('makes Projects Home the root and exposes canonical project routes through one workspace function', async () => {
    const config = JSON.parse(await readFile('vercel.json', 'utf8')) as {
      routes: Array<{ src?: string; dest?: string }>;
    };
    const routes = new Map(config.routes.filter((route) => route.src).map((route) => [route.src as string, route.dest]));

    expect(routes.get('^/$')).toBe('/api/workspace?view=home');
    expect(routes.get('^/projects/([^/]+)/?$')).toBe('/api/workspace?view=project');
    expect(routes.get('^/projects/([^/]+)/anchors/?$')).toBe('/api/workspace?view=collection');
    expect(routes.get('^/projects/([^/]+)/assets/?$')).toBe('/api/workspace?view=collection');
    expect(routes.get('^/projects/([^/]+)/generations/?$')).toBe('/api/workspace?view=collection');
    expect(routes.get('^/projects/([^/]+)/anchors/([^/]+)/?$')).toBe('/api/workspace?view=anchor');
  });

  it('routes project-scoped APIs with explicit project identity', async () => {
    const config = JSON.parse(await readFile('vercel.json', 'utf8')) as {
      routes: Array<{ src?: string; dest?: string }>;
    };
    const routes = new Map(config.routes.filter((route) => route.src).map((route) => [route.src as string, route.dest]));

    expect(routes.get('^/api/projects/([^/]+)/overview/?$')).toBe('/api/overview?project_id=$1');
    expect(routes.get('^/api/projects/([^/]+)/asset/?$')).toBe('/api/asset?project_id=$1');
    expect(routes.get('^/api/projects/([^/]+)/anchor-detail/?$')).toBe('/api/anchor-detail?project_id=$1');
  });

  it('does not embed a Bottom of Thirst fallback in canonical project pages or APIs', async () => {
    for (const file of [
      'src/web/home.ts',
      'src/web/project-pages.ts',
      'api/overview.ts',
      'api/asset.ts',
      'api/anchor-detail.ts',
    ]) {
      const source = await readFile(file, 'utf8');
      expect(source).not.toContain("||'bottom-of-thirst'");
      expect(source).not.toContain("|| 'bottom-of-thirst'");
      expect(source).not.toContain('|| "bottom-of-thirst"');
    }

    const assetApi = await readFile('api/asset.ts', 'utf8');
    expect(assetApi).not.toContain('VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REPO');
    expect(assetApi).not.toContain('VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REF');
  });

  it('keeps project identity visible in canonical navigation and API requests', async () => {
    const pages = await readFile('src/web/project-pages.ts', 'utf8');

    expect(pages).toContain("root='/projects/'+encodeURIComponent(project)");
    expect(pages).toContain("'/api/projects/'+encodeURIComponent(project)+'/overview'");
    expect(pages).toContain("'/api/projects/'+encodeURIComponent(project)+'/anchor-detail?subject_id='");
  });

  it('stays within the Vercel Hobby serverless function limit', async () => {
    const apiFiles = (await readdir('api')).filter((file) => file.endsWith('.ts'));
    expect(apiFiles.length).toBeLessThanOrEqual(12);
    expect(apiFiles).toContain('workspace.ts');
    expect(apiFiles).not.toContain('home.ts');
    expect(apiFiles).not.toContain('project-dashboard.ts');
    expect(apiFiles).not.toContain('project-collection.ts');
    expect(apiFiles).not.toContain('project-anchor-detail.ts');
  });
});
