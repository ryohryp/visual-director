import { createHash } from 'node:crypto';

import type { GenerationPackage } from './types.js';

export const GENERATION_PACKAGE_SCHEMA_VERSION = 1;

export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => (item === undefined ? 'null' : canonicalJsonStringify(item)));
    return `[${items.join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries: string[] = [];

  for (const key of keys) {
    const val = record[key];
    if (val !== undefined) {
      entries.push(`${JSON.stringify(key)}:${canonicalJsonStringify(val)}`);
    }
  }

  return `{${entries.join(',')}}`;
}

export function computeGenerationFingerprint(
  pkg: Omit<GenerationPackage, 'fingerprint'> | GenerationPackage,
): string {
  const payload = { ...pkg } as Partial<GenerationPackage>;
  delete payload.fingerprint;
  const canonical = canonicalJsonStringify(payload);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
