import { createHash } from 'node:crypto';

/**
 * Serializes a JSON-compatible value with object keys sorted at every depth,
 * so that two values differing only in key order produce identical output.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}

/** Computes a lowercase hex SHA-256 digest of a value's canonical JSON form. */
export function computeFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}
