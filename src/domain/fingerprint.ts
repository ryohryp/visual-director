import { createHash } from 'node:crypto';

/**
 * Serializes a JSON-compatible value into a string with object keys sorted
 * recursively, so semantically identical objects produce identical output
 * regardless of property insertion order. Array order is preserved because
 * it is part of the value's meaning.
 */
export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`,
    );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Computes a deterministic SHA-256 fingerprint (lowercase hex) for a
 * JSON-compatible value. Callers are responsible for excluding any
 * environment- or execution-dependent fields (timestamps, absolute repo
 * paths, session ids, the fingerprint field itself) before calling this.
 */
export function computeFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}
