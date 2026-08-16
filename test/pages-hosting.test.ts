import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('static diagnostic hosting', () => {
  it('keeps automatic Vercel deployments limited to main', async () => {
    const raw = await readFile(new URL('../vercel.json', import.meta.url), 'utf8');
    const config = JSON.parse(raw) as {
      git?: { deploymentEnabled?: Record<string, boolean> };
    };

    expect(config.git?.deploymentEnabled).toEqual({
      '*': false,
      main: true,
    });
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
