import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const elements = value.map((item) => canonicalJson(item));
    return `[${elements.join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => key !== 'fingerprint' && record[key] !== undefined)
    .sort();

  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(',')}}`;
}

export function computeGenerationPackageFingerprint(pkg: object): string {
  const serialized = canonicalJson(pkg);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
