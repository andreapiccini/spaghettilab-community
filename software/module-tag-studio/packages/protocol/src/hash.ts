/** SHA-256 truncated to first 16 bytes (protocol hash fields). */

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto SHA-256 is required (available in modern browsers and Node.js)");
  }
  // Copy into a fresh ArrayBuffer-backed view for BufferSource typing across DOM/Node libs.
  const input = new Uint8Array(data);
  const digest = await subtle.digest("SHA-256", input);
  return new Uint8Array(digest);
}

export async function truncatedSha256(data: Uint8Array): Promise<Uint8Array> {
  return (await sha256(data)).slice(0, 16);
}

export async function deviceBindingHash(publicKeyOrUid: Uint8Array): Promise<Uint8Array> {
  return truncatedSha256(publicKeyOrUid);
}

/**
 * Canonical JSON (RFC 8785 subset sufficient for module definitions):
 * - object keys sorted
 * - no whitespace
 * - UTF-8
 */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortValue(obj[key]);
  }
  return out;
}

export async function definitionHashFromJson(definition: unknown): Promise<Uint8Array> {
  const canonical = canonicalizeJson(definition);
  return truncatedSha256(new TextEncoder().encode(canonical));
}
