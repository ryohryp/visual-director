import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const pluginRoot = path.resolve('plugin/visual-director');
const portableManifestPath = path.join(pluginRoot, 'plugin.json');
const mcpConfigPath = path.join(pluginRoot, 'mcp.json');
const codexManifestPath = path.join(pluginRoot, '.codex-plugin/plugin.json');
const skillPath = path.join(pluginRoot, 'skills/visual-director/SKILL.md');

const pluginSchema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const mcpSchema = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const allowedPluginKeys = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions',
]);

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
}

describe('Agent Plugins 1.0 portable package', () => {
  it('keeps plugin.json inside the published closed manifest schema', async () => {
    const manifest = await readJson(portableManifestPath);

    expect(manifest.$schema).toBe(pluginSchema);
    expect(manifest.name).toBe('visual-director');
    expect(manifest.version).toBe('0.1.0');
    expect(Object.keys(manifest).every((key) => allowedPluginKeys.has(key))).toBe(true);

    const name = String(manifest.name);
    expect(name.length).toBeGreaterThanOrEqual(1);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toMatch(/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);

    const author = manifest.author as Record<string, unknown>;
    expect(Object.keys(author).every((key) => ['name', 'email', 'url'].includes(key))).toBe(true);
    expect(author.name).toBe('ryohryp');
  });

  it('declares the existing hosted MCP as secret-free Streamable HTTP', async () => {
    const config = await readJson(mcpConfigPath);

    expect(config.$schema).toBe(mcpSchema);
    expect(Object.keys(config).sort()).toEqual(['$schema', 'mcpServers'].sort());

    const servers = config.mcpServers as Record<string, Record<string, unknown>>;
    expect(Object.keys(servers)).toEqual(['visual-director']);

    const server = servers['visual-director'];
    expect(server).toEqual({
      type: 'streamable-http',
      url: 'https://visual-director-beta.vercel.app/mcp',
    });

    const url = new URL(String(server.url));
    expect(url.protocol).toBe('https:');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(url.hash).toBe('');
    expect(server).not.toHaveProperty('headers');
  });

  it('reuses the existing skill from the fixed portable discovery location', async () => {
    const skill = await readFile(skillPath, 'utf8');
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? '';

    expect(frontmatter).toContain('name: visual-director');
    expect(frontmatter).toMatch(/description:\s*\S/u);
    expect(path.basename(path.dirname(skillPath))).toBe('visual-director');
  });

  it('keeps the Codex-specific manifest as a separate compatibility layer', async () => {
    const portableManifest = await readJson(portableManifestPath);
    const codexManifest = await readJson(codexManifestPath);

    expect(codexManifest.name).toBe('visual-director');
    expect(codexManifest.skills).toBe('./skills/');
    expect(codexManifest).toHaveProperty('interface');
    expect(portableManifest).not.toHaveProperty('skills');
    expect(portableManifest).not.toHaveProperty('interface');
  });
});
