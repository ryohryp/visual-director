import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('static diagnostic hosting', () => {
  it('keeps automatic Vercel deployments limited to main', async () => {
    const raw = await readFile(new URL('../vercel.json', import.meta.url), 'utf8');
    const config = JSON.parse(raw) as {
      git?: { deploymentEnabled?: Record<string, boolean> };
      routes?: Array<{ src?: string; dest?: string }>;
    };

    expect(config.git?.deploymentEnabled).toEqual({
      '*': false,
      main: true,
    });
    expect(config.routes).toContainEqual({
      src: '^/diagnostics/?$',
      dest: '/diagnostics/index.html',
    });
  });

  it('bundles diagnostics into the production build', async () => {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const packageJson = JSON.parse(raw) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.build).toContain('scripts/build-diagnostics.mjs');
  });

  it('documents the repository-native path and optional MCP boundary', async () => {
    const html = await readFile(new URL('../pages/index.html', import.meta.url), 'utf8');

    expect(html).toContain('.visual-director/compiled-canon.json');
    expect(html).toContain('Repository native');
    expect(html).toContain('Optional runtime');
    expect(html).toContain('must_use_approved_anchor');
    expect(html).toContain('__BUILD_REVISION__');
  });
});
