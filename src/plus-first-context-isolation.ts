export type NativeImageContextBlockCode =
  | 'UNSAFE_CONVERSATION_IMAGE_CONTEXT'
  | 'REFERENCE_OUTSIDE_GENERATION_PACKAGE'
  | 'REFERENCE_BINDING_MISMATCH_LIMIT';

export interface NativeImageContextInput {
  /** Exact repository reference paths allowed by the current Generation Package. */
  allowed_reference_paths: string[];
  /** Reference paths the host will actually bind to the native image request. */
  bound_reference_paths: string[];
  /** True when unrelated uploaded/generated images exist in the same conversation context. */
  conversation_has_unrelated_images: boolean;
  /** True only when the host can guarantee an explicit reference whitelist or no-reference mode. */
  host_enforces_reference_whitelist: boolean;
  /** Number of consecutive outputs that showed the same wrong image/reference binding. */
  consecutive_reference_mismatches?: number;
}

export type NativeImageContextDecision =
  | { allowed: true }
  | { allowed: false; code: NativeImageContextBlockCode; message: string };

/**
 * Fail-closed gate for ChatGPT/host-native image generation.
 *
 * This does not inspect conversation history itself. The host adapter supplies what it
 * knows about the current image context and this function decides whether generation is
 * safe to invoke under the current Generation Package.
 */
export function evaluateNativeImageContext(input: NativeImageContextInput): NativeImageContextDecision {
  if ((input.consecutive_reference_mismatches ?? 0) >= 2) {
    return {
      allowed: false,
      code: 'REFERENCE_BINDING_MISMATCH_LIMIT',
      message: 'Stop after two consecutive reference-binding mismatches; do not regenerate in the same context.',
    };
  }

  const allowed = new Set(input.allowed_reference_paths.map(normalizeReferencePath));
  const outsidePackage = input.bound_reference_paths
    .map(normalizeReferencePath)
    .find((referencePath) => !allowed.has(referencePath));
  if (outsidePackage) {
    return {
      allowed: false,
      code: 'REFERENCE_OUTSIDE_GENERATION_PACKAGE',
      message: `Native generation attempted to bind a reference outside the current Generation Package: ${outsidePackage}`,
    };
  }

  if (input.conversation_has_unrelated_images && !input.host_enforces_reference_whitelist) {
    return {
      allowed: false,
      code: 'UNSAFE_CONVERSATION_IMAGE_CONTEXT',
      message: 'Unrelated conversation images are present and the host cannot guarantee an explicit reference whitelist or no-reference mode.',
    };
  }

  return { allowed: true };
}

function normalizeReferencePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
