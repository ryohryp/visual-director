import { createHash } from 'node:crypto';

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { inspectImage, MAX_IMAGE_BYTES } from '../domain/image.js';
import { VisualDirectorError } from '../domain/types.js';
import { createCatalogRepositorySource, resolveCatalogEntry } from '../projects/catalog-runtime.js';
import type { RepositorySource } from '../projects/repository-source.js';

export interface ApprovedSourceFileReference {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

export interface ApprovedEditSourceBinding {
  project_id: string;
  candidate_id: string;
  manifest_path: string;
  status: 'bound';
  binding_id: string;
  parent_generation_id: string;
  location_base_id?: string;
  sha256: string;
  mime_type: string;
  width: number;
  height: number;
  source_file_id: string;
  policy: {
    must_edit_returned_image: true;
    must_not_generate_from_text_only: true;
    must_not_use_other_conversation_images: true;
    must_verify_parent_generation_id_after_edit: true;
  };
}

export interface BoundApprovedEditSource {
  binding: ApprovedEditSourceBinding;
  bytes: Uint8Array;
}

interface ApprovedCandidateManifest {
  candidate_id: string;
  status: 'approved_candidate';
  location_base_id?: string;
  generation: {
    generation_id: string;
    original_dimensions: [number, number];
    original_sha256: string;
  };
}

export function registerApprovedEditSourceTool(server: McpServer): void {
  server.registerTool(
    'visual.bind_approved_edit_source',
    {
      title: 'Bind Approved image edit source',
      description:
        'Fail-closed binding for image edits. Reads an approved candidate manifest from the hosted project repository, accepts exactly one host file as approved_source_file, verifies its SHA-256 and pixel dimensions against the manifest, then returns those exact bytes as MCP image content. Use the returned image as the sole edit target. If this tool cannot bind the exact Approved source, do not perform a text-only regeneration or use another conversation image.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({
        project_id: z.string().min(1),
        candidate_manifest_path: z.string().min(1),
        approved_source_file: z.object({
          download_url: z.string().url(),
          file_id: z.string().min(1),
          mime_type: z.string().min(1).optional(),
          file_name: z.string().min(1).optional(),
        }),
      }),
      _meta: { 'openai/fileParams': ['approved_source_file'] },
      outputSchema: z.object({
        project_id: z.string(),
        candidate_id: z.string(),
        manifest_path: z.string(),
        status: z.literal('bound'),
        binding_id: z.string(),
        parent_generation_id: z.string(),
        location_base_id: z.string().optional(),
        sha256: z.string(),
        mime_type: z.string(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        source_file_id: z.string(),
        policy: z.object({
          must_edit_returned_image: z.literal(true),
          must_not_generate_from_text_only: z.literal(true),
          must_not_use_other_conversation_images: z.literal(true),
          must_verify_parent_generation_id_after_edit: z.literal(true),
        }),
      }),
    },
    async (input) => {
      try {
        const entry = resolveCatalogEntry(input.project_id);
        const source = createCatalogRepositorySource(entry);
        const result = await bindApprovedEditSource(
          input.project_id,
          input.candidate_manifest_path,
          input.approved_source_file,
          source,
          fetch,
        );
        return {
          structuredContent: { ...result.binding } as Record<string, unknown>,
          content: [
            { type: 'text' as const, text: JSON.stringify(result.binding, null, 2) },
            {
              type: 'image' as const,
              data: Buffer.from(result.bytes).toString('base64'),
              mimeType: result.binding.mime_type,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(serializeError(error), null, 2) }],
        };
      }
    },
  );
}

export async function bindApprovedEditSource(
  projectId: string,
  candidateManifestPath: string,
  approvedSourceFile: ApprovedSourceFileReference,
  source: RepositorySource,
  fetchImpl: typeof fetch = fetch,
): Promise<BoundApprovedEditSource> {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) throw new VisualDirectorError('INVALID_INPUT', 'project_id is required.');
  const manifestPath = safeManifestPath(candidateManifestPath);
  const manifest = parseApprovedCandidateManifest(
    await source.readText(manifestPath, 'Approved Candidate manifest'),
    manifestPath,
  );
  const downloaded = await downloadApprovedSourceFile(approvedSourceFile, fetchImpl);
  const actualSha256 = createHash('sha256').update(downloaded.bytes).digest('hex');
  if (actualSha256 !== manifest.generation.original_sha256) {
    throw new VisualDirectorError(
      'APPROVED_SOURCE_SHA_MISMATCH',
      'The supplied image file does not match the Approved Candidate SHA-256.',
      {
        candidate_id: manifest.candidate_id,
        expected_sha256: manifest.generation.original_sha256,
        actual_sha256: actualSha256,
      },
    );
  }
  const [expectedWidth, expectedHeight] = manifest.generation.original_dimensions;
  if (downloaded.image.width !== expectedWidth || downloaded.image.height !== expectedHeight) {
    throw new VisualDirectorError(
      'APPROVED_SOURCE_DIMENSIONS_MISMATCH',
      'The supplied image file dimensions do not match the Approved Candidate manifest.',
      {
        candidate_id: manifest.candidate_id,
        expected_dimensions: [expectedWidth, expectedHeight],
        actual_dimensions: [downloaded.image.width, downloaded.image.height],
      },
    );
  }

  const bindingId = createHash('sha256')
    .update(`${normalizedProjectId}\0${manifest.candidate_id}\0${manifest.generation.generation_id}\0${actualSha256}`)
    .digest('hex');

  return {
    binding: {
      project_id: normalizedProjectId,
      candidate_id: manifest.candidate_id,
      manifest_path: manifestPath,
      status: 'bound',
      binding_id: bindingId,
      parent_generation_id: manifest.generation.generation_id,
      ...(manifest.location_base_id ? { location_base_id: manifest.location_base_id } : {}),
      sha256: actualSha256,
      mime_type: downloaded.image.mime_type,
      width: downloaded.image.width,
      height: downloaded.image.height,
      source_file_id: approvedSourceFile.file_id,
      policy: {
        must_edit_returned_image: true,
        must_not_generate_from_text_only: true,
        must_not_use_other_conversation_images: true,
        must_verify_parent_generation_id_after_edit: true,
      },
    },
    bytes: downloaded.bytes,
  };
}

function parseApprovedCandidateManifest(raw: string, manifestPath: string): ApprovedCandidateManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new VisualDirectorError('APPROVED_SOURCE_MANIFEST_INVALID', 'Approved Candidate manifest is not valid JSON.', {
      path: manifestPath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (!isRecord(parsed) || parsed.status !== 'approved_candidate' || typeof parsed.candidate_id !== 'string' || !parsed.candidate_id.trim()) {
    throw new VisualDirectorError(
      'APPROVED_SOURCE_NOT_APPROVED',
      'The edit source manifest must describe an approved_candidate.',
      { path: manifestPath },
    );
  }
  const generation = parsed.generation;
  if (!isRecord(generation)
    || typeof generation.generation_id !== 'string' || !generation.generation_id.trim()
    || typeof generation.original_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(generation.original_sha256)
    || !Array.isArray(generation.original_dimensions) || generation.original_dimensions.length !== 2
    || !generation.original_dimensions.every((value) => Number.isSafeInteger(value) && Number(value) > 0)) {
    throw new VisualDirectorError(
      'APPROVED_SOURCE_MANIFEST_INVALID',
      'Approved Candidate manifest requires generation_id, original_sha256, and two positive original_dimensions.',
      { path: manifestPath },
    );
  }
  const [width, height] = generation.original_dimensions as [number, number];
  const locationBaseId = parsed.location_base_id;
  if (locationBaseId !== undefined && (typeof locationBaseId !== 'string' || !locationBaseId.trim())) {
    throw new VisualDirectorError('APPROVED_SOURCE_MANIFEST_INVALID', 'location_base_id must be a non-empty string when present.', {
      path: manifestPath,
    });
  }
  return {
    candidate_id: parsed.candidate_id.trim(),
    status: 'approved_candidate',
    ...(typeof locationBaseId === 'string' ? { location_base_id: locationBaseId.trim() } : {}),
    generation: {
      generation_id: generation.generation_id.trim(),
      original_dimensions: [width, height],
      original_sha256: generation.original_sha256,
    },
  };
}

async function downloadApprovedSourceFile(
  file: ApprovedSourceFileReference,
  fetchImpl: typeof fetch,
): Promise<{ bytes: Uint8Array; image: ReturnType<typeof inspectImage> }> {
  if (!file || typeof file !== 'object' || typeof file.download_url !== 'string' || !file.download_url.trim()
    || typeof file.file_id !== 'string' || !file.file_id.trim()) {
    throw new VisualDirectorError('INVALID_FILE_REFERENCE', 'approved_source_file must include download_url and file_id.');
  }
  if (file.file_name && /[\\/]/.test(file.file_name)) {
    throw new VisualDirectorError('UNSAFE_FILE_REFERENCE', 'approved_source_file.file_name must be a file name, not a path.');
  }
  let downloadUrl: URL;
  try {
    downloadUrl = new URL(file.download_url);
  } catch {
    throw new VisualDirectorError('FILE_DOWNLOAD_URL_INVALID', 'approved_source_file.download_url must be a valid HTTPS URL.');
  }
  if (downloadUrl.protocol !== 'https:' || downloadUrl.username || downloadUrl.password) {
    throw new VisualDirectorError('FILE_DOWNLOAD_URL_INVALID', 'approved_source_file.download_url must be a credential-free HTTPS URL.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(downloadUrl.toString(), { redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      throw new VisualDirectorError('FILE_DOWNLOAD_FAILED', 'Redirects are not accepted for approved source files.');
    }
    if (!response.ok) {
      throw new VisualDirectorError('FILE_DOWNLOAD_FAILED', 'The approved source file download returned an error.', {
        status: response.status,
      });
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new VisualDirectorError('IMAGE_TOO_LARGE', 'The downloaded approved source exceeds the 25 MiB limit.', {
        max_bytes: MAX_IMAGE_BYTES,
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new VisualDirectorError('IMAGE_TOO_LARGE', 'The downloaded approved source exceeds the 25 MiB limit.', {
        max_bytes: MAX_IMAGE_BYTES,
      });
    }
    const image = inspectImage(bytes, {
      declaredMimeType: file.mime_type ?? response.headers.get('content-type') ?? undefined,
      fileName: file.file_name,
    });
    return { bytes, image };
  } catch (error) {
    if (error instanceof VisualDirectorError) throw error;
    throw new VisualDirectorError('FILE_DOWNLOAD_FAILED', 'The approved source file could not be downloaded.', {
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeout);
  }
}

function safeManifestPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new VisualDirectorError('UNSAFE_REPOSITORY_PATH', 'candidate_manifest_path must be repository-relative.', {
      candidate_manifest_path: value,
    });
  }
  if (!normalized.endsWith('.json')) {
    throw new VisualDirectorError('APPROVED_SOURCE_MANIFEST_INVALID', 'candidate_manifest_path must point to a JSON manifest.', {
      candidate_manifest_path: value,
    });
  }
  return normalized;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof VisualDirectorError) {
    return { error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  }
  return { error: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
