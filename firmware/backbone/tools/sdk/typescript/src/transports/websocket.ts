import { decodeRequest, decodeResponse } from "../config-codec.js";
import type { ProtocolTransport } from "../transport.js";

/**
 * Minimal WebSocket surface — browser or `ws` adapter.
 * Binary frames carry Protocol V1 CBOR; text frames are control-only.
 */
export interface WebSocketConnection {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array | string) => void): () => void;
  close(): Promise<void>;
}

/**
 * WebSocket adapter for the BLE gateway (phase 375). Same byte contract as MQTT.
 */
export class WebSocketProtocolTransport implements ProtocolTransport {
  readonly name = "websocket";
  private readonly pending = new Map<
    number,
    {
      resolve: (bytes: Uint8Array) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly eventBuffers: Uint8Array[] = [];
  private readonly eventWaiters: Array<(value: IteratorResult<Uint8Array>) => void> =
    [];
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(private readonly connection: WebSocketConnection) {
    this.unsubscribe = this.connection.onMessage((data) => {
      if (typeof data === "string") {
        return; // control only (select_device, boot_id_changed, …)
      }
      this.onBinary(new Uint8Array(data));
    });
  }

  async send(request: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    if (this.closed) throw new Error("websocket transport closed");
    const copy = new Uint8Array(request);
    const correlationId = decodeRequest(copy).correlationId;
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(new Error("timeout"));
      }, timeoutMs);
      this.pending.set(correlationId, { resolve, reject, timer });
      try {
        this.connection.send(copy);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(correlationId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  events(): AsyncIterable<Uint8Array> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        return {
          next(): Promise<IteratorResult<Uint8Array>> {
            if (self.eventBuffers.length > 0) {
              return Promise.resolve({
                value: self.eventBuffers.shift()!,
                done: false,
              });
            }
            if (self.closed) {
              return Promise.resolve({
                value: undefined as unknown as Uint8Array,
                done: true,
              });
            }
            return new Promise((resolve) => {
              self.eventWaiters.push(resolve);
            });
          },
        };
      },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribe();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("websocket transport closed"));
    }
    this.pending.clear();
    while (this.eventWaiters.length > 0) {
      this.eventWaiters.shift()!({
        value: undefined as unknown as Uint8Array,
        done: true,
      });
    }
    await this.connection.close();
  }

  private onBinary(bytes: Uint8Array): void {
    try {
      const response = decodeResponse(bytes);
      const pending = this.pending.get(response.correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(response.correlationId);
        pending.resolve(bytes);
        return;
      }
    } catch {
      // not a response — treat as event
    }
    this.pushEvent(bytes);
  }

  private pushEvent(bytes: Uint8Array): void {
    if (this.eventWaiters.length > 0) {
      this.eventWaiters.shift()!({ value: bytes, done: false });
    } else {
      this.eventBuffers.push(bytes);
    }
  }
}
