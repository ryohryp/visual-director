import { VisualDirectorError } from '../domain/types.js';

export interface GitHubRepositoryWriterOptions {
  owner: string;
  repo: string;
  ref: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface RepositoryTextWrite {
  path: string;
  content: string;
}

export interface RepositoryCommitResult {
  commit_sha: string;
  ref: string;
  changed_paths: string[];
}

export class GitHubRepositoryWriter {
  private readonly owner: string;
  private readonly repo: string;
  private readonly ref: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GitHubRepositoryWriterOptions) {
    this.owner = required(options.owner, 'owner');
    this.repo = required(options.repo, 'repo');
    this.ref = required(options.ref, 'ref');
    this.token = required(options.token, 'token');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async commitTextFiles(files: readonly RepositoryTextWrite[], message: string): Promise<RepositoryCommitResult> {
    if (files.length === 0) {
      throw new VisualDirectorError('HOSTED_ANCHOR_WRITE_FAILED', 'At least one repository file is required for an Anchor adoption commit.');
    }
    const normalizedFiles = files.map((file) => ({
      path: safeRelativePath(file.path),
      content: file.content,
    }));
    if (new Set(normalizedFiles.map((file) => file.path)).size !== normalizedFiles.length) {
      throw new VisualDirectorError('HOSTED_ANCHOR_WRITE_FAILED', 'Anchor adoption cannot write the same repository path more than once.');
    }

    const head = await this.jsonRequest<{ object?: { sha?: string } }>(
      'GET',
      `/git/ref/heads/${encodeRef(this.ref)}`,
    );
    const headSha = head.object?.sha;
    if (!headSha) throw this.invalidResponse('Repository branch head did not include a commit SHA.');

    const commit = await this.jsonRequest<{ tree?: { sha?: string } }>('GET', `/git/commits/${encodeURIComponent(headSha)}`);
    const baseTreeSha = commit.tree?.sha;
    if (!baseTreeSha) throw this.invalidResponse('Repository head commit did not include a tree SHA.');

    const tree = [] as Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }>;
    for (const file of normalizedFiles) {
      const blob = await this.jsonRequest<{ sha?: string }>('POST', '/git/blobs', {
        content: file.content,
        encoding: 'utf-8',
      });
      if (!blob.sha) throw this.invalidResponse(`GitHub did not return a blob SHA for ${file.path}.`);
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const createdTree = await this.jsonRequest<{ sha?: string }>('POST', '/git/trees', {
      base_tree: baseTreeSha,
      tree,
    });
    if (!createdTree.sha) throw this.invalidResponse('GitHub did not return a tree SHA for the Anchor adoption commit.');

    const createdCommit = await this.jsonRequest<{ sha?: string }>('POST', '/git/commits', {
      message: message.trim() || 'chore: adopt approved visual anchor',
      tree: createdTree.sha,
      parents: [headSha],
    });
    if (!createdCommit.sha) throw this.invalidResponse('GitHub did not return a commit SHA for the Anchor adoption commit.');

    await this.jsonRequest('PATCH', `/git/refs/heads/${encodeRef(this.ref)}`, {
      sha: createdCommit.sha,
      force: false,
    });

    return {
      commit_sha: createdCommit.sha,
      ref: this.ref,
      changed_paths: normalizedFiles.map((file) => file.path),
    };
  }

  private async jsonRequest<T = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'PATCH',
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${endpoint}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'visual-director-hosted-anchor-writer',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw new VisualDirectorError('HOSTED_ANCHOR_WRITE_FAILED', 'The hosted Anchor repository write request failed.', {
        repository: `${this.owner}/${this.repo}`,
        ref: this.ref,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (!response.ok) {
      throw new VisualDirectorError('HOSTED_ANCHOR_WRITE_FAILED', 'The hosted Anchor repository write was rejected by GitHub.', {
        repository: `${this.owner}/${this.repo}`,
        ref: this.ref,
        status: response.status,
      });
    }
    if (response.status === 204) return {} as T;
    try {
      return await response.json() as T;
    } catch (error) {
      throw this.invalidResponse(error instanceof Error ? error.message : String(error));
    }
  }

  private invalidResponse(reason: string): VisualDirectorError {
    return new VisualDirectorError('HOSTED_ANCHOR_WRITE_FAILED', 'GitHub returned an invalid response while committing the Approved Anchor binding.', {
      repository: `${this.owner}/${this.repo}`,
      ref: this.ref,
      reason,
    });
  }
}

function safeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'Repository write paths must stay inside the configured repository.', {
      path: value,
    });
  }
  return normalized;
}

function encodeRef(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new VisualDirectorError('PROJECT_CONFIG_INVALID', `GitHub repository writer ${field} must not be empty.`);
  return trimmed;
}
