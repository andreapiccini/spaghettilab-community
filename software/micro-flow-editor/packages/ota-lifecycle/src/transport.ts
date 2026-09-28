/** `enum spaghetti_update_transport`, `firmware/backbone/include/spaghetti/update.h:17-22` — sequential 0..3. */
export enum UpdateTransport {
  NONE = 0,
  UART = 1,
  UDP = 2,
  BLE = 3,
}

const TRANSPORT_LABELS: Record<number, string> = { 0: "NONE", 1: "UART", 2: "UDP", 3: "BLE" };

export function updateTransportLabel(transport: number): string {
  return TRANSPORT_LABELS[transport] ?? `UNKNOWN(${transport})`;
}

/**
 * Whether an interrupted upload can resume from where it left off, for real,
 * on this firmware — checked directly against `update.h`, not assumed from
 * `WRITE_BLE_UPDATE`'s `offset` field looking resume-shaped:
 *
 * - `spaghetti_update_write()`'s doc comment (`update.h:100-115`) is explicit:
 *   "Expected zero-based byte offset. **Chunks must be contiguous**" and
 *   `-EPERM` is returned when "No transport currently owns a RECEIVING
 *   session." `offset` is a contiguity/integrity check on an *already-owned*
 *   session, not a seek/resume primitive — a session lost to a disconnect
 *   cannot be re-attached; a caller must arm a fresh session and start
 *   writing from byte 0 again.
 * - Wi-Fi (`UDP`) upload happens over a raw channel entirely outside
 *   Protocol V1's CBOR envelope (`OPEN_WIFI_UPDATE` only returns a handover
 *   address/port) — this SDK has no visibility into that channel's resume
 *   behavior at all, so it cannot claim resume support for it either.
 *
 * So for every transport this SDK can observe, the honest answer is
 * `false` — "resume soltanto se il protocollo lo garantisce" (S103 §
 * Implementazione point 1) resolves to "never, on this firmware version,"
 * not a guessed `true`.
 */
export function canResumeAfterDisconnect(_transport: UpdateTransport): boolean {
  return false;
}
