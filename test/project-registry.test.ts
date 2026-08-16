import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { VisualDirectorError } from '../src/domain/types.js';
import {
  DEFAULT_PROJECT_REGISTRY_PATH,
  parseProjectRegistry,
  resolveProjectRegistryPath,
} from '../src/projects/project-registry.js';

describe('Project Registry', () => {
  it('defaults to ~/.visual-director/projects.json', () => {
    expect(DEFAULT_PROJECT_REGISTRY_PATH).toBe(path.join(os.homedir(), '.visual-director', 'projects.json'));
  });

  it('resolves project_id to an absolute local repository path', () => {
    const registry = parseProjectRegistry({
      projects: {
        'game-a': { repository: './fixtures/game-a' },
      },
    });

    expect(registry.resolve('game-a')).toEqual({
      project_id: 'game-a',
      repository: path.resolve('./fixtures/game-a'),
    });
  });

  it('expands a home-relative repository path', () => {
    const registry = parseProjectRegistry({
      projects: {
        'game-a': { repository: '~/src/game-a' },
      },
    });

    expect(registry.resolve('game-a').repository).toBe(path.join(os.homedir(), 'src/game-a'));
  });

  it('fails clearly for an unregistered project', () => {
    const registry = parseProjectRegistry({ projects: {} });
    expect(() => registry.resolve('missing')).toThrowError(VisualDirectorError);
    expect(() => registry.resolve('missing')).toThrow('Unknown project_id: missing.');
  });

  it('rejects malformed entries', () => {
    expect(() => parseProjectRegistry({ projects: { game: {} } })).toThrow('requires repository');
    expect(() => parseProjectRegistry({ projects: [] })).toThrow('projects object');
  });

  it('allows an explicit registry path to override the default', () => {
    expect(resolveProjectRegistryPath('/tmp/projects.json')).toBe('/tmp/projects.json');
  });
});
