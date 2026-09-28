/**
 * `compute_config_hash`/`compute_sha256` (`firmware/backbone/subsys/config/config.c`)
 * — SHA-256 over exactly the canonical CBOR bytes `spaghetti_config_encode_cbor`
 * produces, the same pattern already used for Device Profile installs
 * (`@spaghettilab/device-profile-install`'s `hash.ts`). Web Crypto
 * `SubtleCrypto`, not `node:crypto`, for the same runtime-agnostic reason.
 */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return new Uint8Array(digest);
}
