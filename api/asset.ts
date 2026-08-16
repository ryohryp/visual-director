import type { IncomingMessage, ServerResponse } from 'node:http';

import { VisualDirectorError } from '../src/domain/types.js';
import { resolveCatalogEntry } from '../src/projects/catalog-runtime.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET');
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/api/asset', 'https://visual-director.local');
  const projectId = url.searchParams.get('project_id')?.trim() ?? '';
  const assetPath = url.searchParams.get('path')?.trim() ?? '';
  if (!projectId || !isSafePath(assetPath)) {
    res.statusCode = 400;
    res.end('Invalid asset request.');
    return;
  }

  let entry;
  try {
    entry = resolveCatalogEntry(projectId);
  } catch (error) {
    if (error instanceof VisualDirectorError && error.code === 'PROJECT_NOT_FOUND') {
      res.statusCode = 404;
      res.end('Unknown project.');
      return;
    }
    res.statusCode = 500;
    res.end('Project Catalog could not be resolved.');
    return;
  }

  const token = process.env.VISUAL_DIRECTOR_GITHUB_TOKEN?.trim();
  if (!token) {
    res.statusCode = 503;
    res.end('Hosted repository access is not configured.');
    return;
  }

  const { owner, name: repo } = entry.repository;
  const encodedPath = assetPath.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(entry.ref)}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'visual-director-dashboard',
      },
    },
  );
  if (!response.ok) {
    res.statusCode = response.status === 404 ? 404 : 502;
    res.end('Asset could not be loaded.');
    return;
  }
  const payload = await response.json() as { type?: string; content?: string; encoding?: string; name?: string };
  if (payload.type !== 'file' || payload.encoding !== 'base64' || typeof payload.content !== 'string') {
    res.statusCode = 404;
    res.end('Asset could not be loaded.');
    return;
  }

  const bytes = Buffer.from(payload.content.replace(/\s/g, ''), 'base64');
  res.statusCode = 200;
  res.setHeader('content-type', mimeType(payload.name ?? assetPath));
  res.setHeader('cache-control', 'private, max-age=300');
  res.end(bytes);
}

function isSafePath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  return Boolean(normalized) && !normalized.startsWith('/') && !/^[a-zA-Z]:/.test(normalized) && !normalized.split('/').includes('..');
}

function mimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}
