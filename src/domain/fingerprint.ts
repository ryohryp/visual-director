import { createHash } from 'node:crypto';

import type { GenerationPackage } from './types.js';

type FingerprintPayload = Omit<GenerationPackage, 'fingerprint'>;

export function fingerprintGenerationPackage(generationPackage: FingerprintPayload): string {
  return sha256Fingerprint(generationPackage);
}

export function sha256Fingerprint(value: unknown): string {
  return createHash('sha256').update(stableJsonStringify(value)).digest('hex');
}

export function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
      .join(',')}}`;
  }
  throw new TypeError('Fingerprint values must be JSON-compatible.');
}
