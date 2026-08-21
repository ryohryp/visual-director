import { describe, expect, it, vi } from 'vitest';

import { bindApprovedEditSource } from '../src/mcp/approved-edit-source.js';
import type { RepositorySource } from '../src/projects/repository-source.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGPkEpFjYGAAAAEmAD5j+GBZAAAAAElFTkSuQmCC';
const PNG_SHA256 = '33135cdb46b55276d616f81ee83c01cd2cf07e3af536f5cf137abc5d489e9810';
const MANIFEST_PATH = 'docs/visual/assets/candidates/library/library_test.json';

function sourceWithManifest(manifest: Record<string, unknown>): RepositorySource {
  return {
    kind: 'github',
    checkAccess: vi.fn(async () => undefined),
    readText: vi.fn(async () => JSON.stringify(manifest)),
    ensureFile: vi.fn(async () => undefined),
    fileExists: vi.fn(async () => true),
  };
}

function approvedManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidate_id: 'library_test-generation',
    status: 'approved_candidate',
    location_base_id: 'library_base_test',
    generation: {
      generation_id: 'test-generation',
      original_dimensions: [2, 1],
      original_sha256: PNG_SHA256,
    },
    ...overrides,
  };
}

function fileReference() {
  return {
    download_url: 'https://files.example.test/library.png',
    file_id: 'file_library_test',
    mime_type: 'image/png',
    file_name: 'library.png',
  };
}

function fetchFor(bytes: Uint8Array): typeof fetch {
  return vi.fn(async () => new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-length': String(bytes.byteLength),
    },
  })) as unknown as typeof fetch;
}

describe('Approved edit source binding', () => {
  it('binds only when the supplied file exactly matches the approved manifest', async () => {
    const bytes = Uint8Array.from(Buffer.from(PNG_BASE64, 'base64'));
    const result = await bindApprovedEditSource(
      'bottom-of-thirst',
      MANIFEST_PATH,
      fileReference(),
      sourceWithManifest(approvedManifest()),
      fetchFor(bytes),
    );

    expect(result.binding).toMatchObject({
      project_id: 'bottom-of-thirst',
      candidate_id: 'library_test-generation',
      manifest_path: MANIFEST_PATH,
      status: 'bound',
      parent_generation_id: 'test-generation',
      location_base_id: 'library_base_test',
      sha256: PNG_SHA256,
      mime_type: 'image/png',
      width: 2,
      height: 1,
      source_file_id: 'file_library_test',
      policy: {
        must_edit_returned_image: true,
        must_not_generate_from_text_only: true,
        must_not_use_other_conversation_images: true,
        must_verify_parent_generation_id_after_edit: true,
      },
    });
    expect(result.binding.binding_id).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(result.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it('accepts a host-managed file_name path by using only its basename as an image hint', async () => {
    const bytes = Uint8Array.from(Buffer.from(PNG_BASE64, 'base64'));
    const result = await bindApprovedEditSource(
      'bottom-of-thirst',
      MANIFEST_PATH,
      {
        ...fileReference(),
        file_name: '/mnt/data/user-session/mnt/data/library.png',
      },
      sourceWithManifest(approvedManifest()),
      fetchFor(bytes),
    );

    expect(result.binding).toMatchObject({
      status: 'bound',
      parent_generation_id: 'test-generation',
      sha256: PNG_SHA256,
      width: 2,
      height: 1,
    });
  });

  it('rejects a manifest that is not approved', async () => {
    const bytes = Uint8Array.from(Buffer.from(PNG_BASE64, 'base64'));
    await expect(bindApprovedEditSource(
      'bottom-of-thirst',
      MANIFEST_PATH,
      fileReference(),
      sourceWithManifest(approvedManifest({ status: 'candidate' })),
      fetchFor(bytes),
    )).rejects.toMatchObject({ code: 'APPROVED_SOURCE_NOT_APPROVED' });
  });

  it('rejects a file whose SHA does not match the approved source', async () => {
    const bytes = Uint8Array.from(Buffer.from(PNG_BASE64, 'base64'));
    const manifest = approvedManifest({
      generation: {
        generation_id: 'test-generation',
        original_dimensions: [2, 1],
        original_sha256: '0'.repeat(64),
      },
    });
    await expect(bindApprovedEditSource(
      'bottom-of-thirst',
      MANIFEST_PATH,
      fileReference(),
      sourceWithManifest(manifest),
      fetchFor(bytes),
    )).rejects.toMatchObject({ code: 'APPROVED_SOURCE_SHA_MISMATCH' });
  });

  it('rejects unsafe manifest paths before repository access', async () => {
    const source = sourceWithManifest(approvedManifest());
    await expect(bindApprovedEditSource(
      'bottom-of-thirst',
      '../library.json',
      fileReference(),
      source,
      fetchFor(Uint8Array.from(Buffer.from(PNG_BASE64, 'base64'))),
    )).rejects.toMatchObject({ code: 'UNSAFE_REPOSITORY_PATH' });
    expect(source.readText).not.toHaveBeenCalled();
  });
});
