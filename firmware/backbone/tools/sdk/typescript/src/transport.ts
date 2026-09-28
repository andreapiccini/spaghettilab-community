/**
 * Byte transport shared by MQTT, WebSocket (BLE gateway), and tests.
 *
 * `Uint8Array` passed to `send()` is owned by the caller until the Promise
 * settles; transports must copy if they retain bytes beyond the call.
 * `events()` yields complete Protocol V1 envelopes (not BLE fragments).
 */
export interface ProtocolTransport {
  readonly name: string;
  send(request: Uint8Array, timeoutMs: number): Promise<Uint8Array>;
  events(): AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}
