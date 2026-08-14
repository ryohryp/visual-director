import { createHash } from 'node:crypto';

/**
 * Serializes JSON-compatible values with object keys sorted recursively.
 * Array order is intentionally preserved because it is meaningful package content.
 */
export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Returns a deterministic lowercase SHA-256 hex digest for package content. */
export function computeFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}
