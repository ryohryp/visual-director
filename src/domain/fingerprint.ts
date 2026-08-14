import { createHash } from 'node:crypto';

import type { GenerationPackage } from './types.js';

export type FingerprintableGenerationPackage = Omit<GenerationPackage, 'fingerprint'>;

export function createGenerationPackageFingerprint(generationPackage: FingerprintableGenerationPackage): string {
  const fingerprintInput: Record<string, unknown> = { ...generationPackage };
  delete fingerprintInput.fingerprint;
  return createHash('sha256').update(stableJsonStringify(fingerprintInput)).digest('hex');
}

export function withGenerationPackageFingerprint(
  generationPackage: FingerprintableGenerationPackage,
): GenerationPackage {
  return {
    ...generationPackage,
    fingerprint: createGenerationPackageFingerprint(generationPackage),
  };
}

export function stableJsonStringify(value: unknown): string {
  const serialized = JSON.stringify(sortObjectKeys(value));
  if (serialized === undefined) {
    throw new TypeError('Generation Package fingerprint input must be JSON-serializable.');
  }
  return serialized;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, child]) => [key, sortObjectKeys(child)]),
  );
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
