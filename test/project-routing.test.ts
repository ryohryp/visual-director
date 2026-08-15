import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('v0.4 project-scoped routing', () => {
  it('makes Projects Home the root and exposes canonical project routes', async () => {
    const config = JSON.parse(await readFile('vercel.json', 'utf8')) as {
      routes: Array<{ src?: string; dest?: string }>;
    };
    const routes = new Map(config.routes.filter((route) => route.src).map((route) => [route.src as string, route.dest]));

    expect(routes.get('^/$')).toBe('/api/home');
    expect(routes.get('^/projects/([^/]+)/?$')).toBe('/api/project-dashboard');
    expect(routes.get('^/projects/([^/]+)/anchors/?$')).toBe('/api/project-collection');
    expect(routes.get('^/projects/([^/]+)/assets/?$')).toBe('/api/project-collection');
    expect(routes.get('^/projects/([^/]+)/generations/?$')).toBe('/api/project-collection');
    expect(routes.get('^/projects/([^/]+)/anchors/([^/]+)/?$')).toBe('/api/project-anchor-detail');
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

  it('does not embed a Bottom of Thirst fallback in canonical project pages', async () => {
    for (const file of [
      'api/home.ts',
      'api/project-dashboard.ts',
      'api/project-collection.ts',
      'api/project-anchor-detail.ts',
    ]) {
      const source = await readFile(file, 'utf8');
      expect(source).not.toContain("||'bottom-of-thirst'");
      expect(source).not.toContain('|| "bottom-of-thirst"');
    }
  });

  it('keeps project identity visible in canonical navigation and API requests', async () => {
    const dashboard = await readFile('api/project-dashboard.ts', 'utf8');
    const collection = await readFile('api/project-collection.ts', 'utf8');
    const anchorDetail = await readFile('api/project-anchor-detail.ts', 'utf8');

    expect(dashboard).toContain("root='/projects/'+encodeURIComponent(project)");
    expect(dashboard).toContain("'/api/projects/'+encodeURIComponent(project)+'/overview'");
    expect(collection).toContain("root='/projects/'+encodeURIComponent(project)");
    expect(anchorDetail).toContain("root='/projects/'+encodeURIComponent(project)");
  });
});
