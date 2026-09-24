/**
 * A deterministic, dependency-free, non-cryptographic content fingerprint.
 * Used for domain-level identity checks (has this Project's deployable
 * content changed?) — never for security, and never confused with the real
 * Config CBOR hash the firmware protocol uses (that is S072's job, over the
 * compiled Config, with the actual algorithm the protocol specifies).
 *
 * Kept free of `node:crypto` / Web Crypto on purpose: this package must stay
 * usable in any JS environment without picking a runtime-specific API.
 */
function fnv1a(input: string): string {
  // 32-bit FNV-1a. Small, synchronous, deterministic — exactly what a
  // content-fingerprint for diffing/dedup needs, nothing more.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Recursively sorts object keys so two structurally-equal values with keys in
 * a different order hash identically. `bigint` becomes a decimal string — the
 * same lossless JSON boundary used by firmware int64 fields — because
 * `JSON.stringify` cannot serialize `bigint` natively, and graph node
 * properties routinely carry `bigint` defaults from the processing catalog.
 */
function canonicalize(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, canonicalize(v)]));
  }
  return value;
}

/** Canonical (sorted-key) JSON string — the same value always serializes identically regardless of construction order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Content fingerprint of `value`, independent of object key order or array-of-object insertion order (caller must pre-sort arrays that don't have significant order). */
export function contentHash(value: unknown): string {
  return fnv1a(canonicalJson(value));
}
