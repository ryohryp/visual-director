import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { VisualDirectorError } from '../domain/types.js';

export interface RepositorySource {
  readonly kind: 'local' | 'github';
  readText(relativePath: string, label: string): Promise<string>;
  ensureFile(relativePath: string, label: string): Promise<void>;
  fileExists(relativePath: string): Promise<boolean>;
}

export class LocalRepositorySource implements RepositorySource {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(repoPath: string) {
    this.root = path.resolve(repoPath);
  }

  async readText(relativePath: string, label: string): Promise<string> {
    const filePath = this.resolve(relativePath);
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      throw new VisualDirectorError('CANON_READ_FAILED', `${label} could not be read.`, {
        path: relativePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async ensureFile(relativePath: string, label: string): Promise<void> {
    const filePath = this.resolve(relativePath);
    try {
      await access(filePath);
    } catch {
      throw new VisualDirectorError('REFERENCE_NOT_FOUND', `${label} does not exist.`, { path: relativePath });
    }
  }

  async fileExists(relativePath: string): Promise<boolean> {
    try {
      await access(this.resolve(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  private resolve(relativePath: string): string {
    const normalized = safeRelativePath(relativePath);
    const resolved = path.resolve(this.root, normalized);
    const prefix = this.root.endsWith(path.sep) ? this.root : `${this.root}${path.sep}`;
    if (resolved !== this.root && !resolved.startsWith(prefix)) {
      throw new VisualDirectorError('REFERENCE_OUTSIDE_REPO', 'A configured project path resolves outside the project repository.', {
        path: relativePath,
      });
    }
    return resolved;
  }
}

export interface GitHubRepositorySourceOptions {
  owner: string;
  repo: string;
  ref?: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export class GitHubRepositorySource implements RepositorySource {
  readonly kind = 'github' as const;
  private readonly owner: string;
  private readonly repo: string;
  private readonly ref: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GitHubRepositorySourceOptions) {
    this.owner = required(options.owner, 'owner');
    this.repo = required(options.repo, 'repo');
    this.ref = options.ref?.trim() || 'main';
    this.token = required(options.token, 'token');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async readText(relativePath: string, label: string): Promise<string> {
    const pathName = safeRelativePath(relativePath);
    const response = await this.request(pathName);
    if (response.status === 404) {
      throw new VisualDirectorError('CANON_READ_FAILED', `${label} was not found in the hosted repository.`, { path: pathName });
    }
    if (!response.ok) throw this.apiError(response.status, pathName);

    const payload = await response.json() as { type?: string; encoding?: string; content?: string };
    if (payload.type !== 'file' || payload.encoding !== 'base64' || typeof payload.content !== 'string') {
      throw new VisualDirectorError('CANON_READ_FAILED', `${label} did not resolve to a readable GitHub file.`, { path: pathName });
    }
    try {
      return Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8');
    } catch (error) {
      throw new VisualDirectorError('CANON_READ_FAILED', `${label} could not be decoded from GitHub.`, {
        path: pathName,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async ensureFile(relativePath: string, label: string): Promise<void> {
    const pathName = safeRelativePath(relativePath);
    const response = await this.request(pathName);
    if (response.status === 404) {
      throw new VisualDirectorError('REFERENCE_NOT_FOUND', `${label} does not exist in the hosted repository.`, { path: pathName });
    }
    if (!response.ok) throw this.apiError(response.status, pathName);
    const payload = await response.json() as { type?: string };
    if (payload.type !== 'file') {
      throw new VisualDirectorError('REFERENCE_NOT_FOUND', `${label} is not a file in the hosted repository.`, { path: pathName });
    }
  }

  async fileExists(relativePath: string): Promise<boolean> {
    const pathName = safeRelativePath(relativePath);
    const response = await this.request(pathName);
    if (response.status === 404) return false;
    if (!response.ok) throw this.apiError(response.status, pathName);
    const payload = await response.json() as { type?: string };
    return payload.type === 'file';
  }

  private request(relativePath: string): Promise<Response> {
    const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(this.ref)}`;
    return this.fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'visual-director-hosted',
      },
    });
  }

  private apiError(status: number, pathName: string): VisualDirectorError {
    return new VisualDirectorError('GITHUB_REPOSITORY_UNAVAILABLE', 'The hosted Canon repository could not be read.', {
      status,
      path: pathName,
      repository: `${this.owner}/${this.repo}`,
      ref: this.ref,
    });
  }
}

function safeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new VisualDirectorError('REFERENCE_OUTSIDE_REPO', 'Repository paths must be relative and must not escape the repository.', {
      path: value,
    });
  }
  return normalized;
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new VisualDirectorError('PROJECT_CONFIG_INVALID', `GitHub repository ${field} must not be empty.`);
  return trimmed;
}
