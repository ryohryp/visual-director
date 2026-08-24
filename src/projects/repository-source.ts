import { access, lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { VisualDirectorError } from '../domain/types.js';

export interface RepositorySource {
  readonly kind: 'local' | 'github';
  checkAccess(): Promise<void>;
  readText(relativePath: string, label: string): Promise<string>;
  ensureFile(relativePath: string, label: string): Promise<void>;
  fileExists(relativePath: string): Promise<boolean>;
  listFiles?(relativeRoot: string): Promise<string[]>;
}

export class LocalRepositorySource implements RepositorySource {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(repoPath: string) {
    this.root = path.resolve(repoPath);
  }

  async checkAccess(): Promise<void> {
    try {
      await access(this.root);
    } catch (error) {
      throw new VisualDirectorError('REPOSITORY_UNAVAILABLE', 'The configured repository path is not accessible.', {
        path: this.root,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
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
      const info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Path is not a regular file.');
    } catch (error) {
      throw new VisualDirectorError('REFERENCE_NOT_FOUND', `${label} does not exist as a regular repository file.`, {
        path: relativePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async fileExists(relativePath: string): Promise<boolean> {
    try {
      const info = await lstat(this.resolve(relativePath));
      return info.isFile() && !info.isSymbolicLink();
    } catch {
      return false;
    }
  }

  async listFiles(relativeRoot: string): Promise<string[]> {
    const normalizedRoot = safeRelativePath(relativeRoot);
    const absoluteRoot = this.resolve(normalizedRoot);
    let rootInfo;
    try {
      rootInfo = await lstat(absoluteRoot);
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw scanError('The configured asset scan root could not be inspected.', normalizedRoot, error);
    }
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw scanError('The configured asset scan root must be a regular repository directory.', normalizedRoot);
    }

    const files: string[] = [];
    const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(absoluteDirectory, { withFileTypes: true });
      } catch (error) {
        throw scanError('A configured asset directory could not be read.', relativeDirectory, error);
      }
      for (const entry of entries) {
        const relativePath = `${relativeDirectory}/${entry.name}`.replace(/\\/g, '/');
        const absolutePath = path.join(absoluteDirectory, entry.name);
        if (entry.isSymbolicLink()) {
          throw scanError('Asset scan roots must not contain symbolic links.', relativePath);
        }
        if (entry.isDirectory()) await visit(absolutePath, relativePath);
        else if (entry.isFile()) files.push(relativePath);
      }
    };
    await visit(absoluteRoot, normalizedRoot);
    return files.sort((left, right) => left.localeCompare(right));
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

  async checkAccess(): Promise<void> {
    const url = `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
    const response = await this.fetchImpl(url, { headers: this.headers() });
    if (!response.ok) throw this.apiError(response.status, '');
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

  async listFiles(relativeRoot: string): Promise<string[]> {
    const normalizedRoot = safeRelativePath(relativeRoot);
    const queue = [normalizedRoot];
    const files: string[] = [];
    let root = true;
    while (queue.length > 0) {
      const directory = queue.shift() as string;
      const response = await this.request(directory);
      if (response.status === 404 && root) return [];
      root = false;
      if (!response.ok) throw this.apiError(response.status, directory);
      const payload = await response.json() as unknown;
      if (!Array.isArray(payload)) {
        throw scanError('The configured hosted asset scan root did not resolve to a directory.', directory);
      }
      if (payload.length >= 1_000) {
        throw new VisualDirectorError(
          'ASSET_SCAN_INCOMPLETE',
          'A hosted asset scan directory reached the GitHub Contents API limit and cannot be reconciled safely.',
          { path: directory, repository: `${this.owner}/${this.repo}`, ref: this.ref },
        );
      }
      for (const value of payload) {
        if (!isRecord(value) || typeof value.path !== 'string' || typeof value.type !== 'string') {
          throw scanError('The hosted asset directory returned an invalid entry.', directory);
        }
        const entryPath = safeRelativePath(value.path);
        const expectedPrefix = `${directory}/`;
        if (!entryPath.startsWith(expectedPrefix) || entryPath.slice(expectedPrefix.length).includes('/')) {
          throw scanError('The hosted asset directory returned an entry outside its requested scope.', entryPath);
        }
        if (value.type === 'dir') queue.push(entryPath);
        else if (value.type === 'file') files.push(entryPath);
        else {
          throw scanError('Asset scan roots must not contain symbolic links or submodules.', entryPath);
        }
      }
    }
    return files.sort((left, right) => left.localeCompare(right));
  }

  private request(relativePath: string): Promise<Response> {
    const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(this.ref)}`;
    return this.fetchImpl(url, { headers: this.headers() });
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${this.token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'visual-director-hosted',
    };
  }

  private apiError(status: number, pathName: string): VisualDirectorError {
    return new VisualDirectorError('GITHUB_REPOSITORY_UNAVAILABLE', 'The hosted Canon repository could not be read.', {
      status,
      ...(pathName ? { path: pathName } : {}),
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

function scanError(message: string, pathName: string, error?: unknown): VisualDirectorError {
  return new VisualDirectorError('ASSET_SCAN_FAILED', message, {
    path: pathName,
    ...(error ? { reason: error instanceof Error ? error.message : String(error) } : {}),
  });
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
