import { decodeRequest, decodeResponse } from "../config-codec.js";
import type { ProtocolTransport } from "../transport.js";

/**
 * Low-level MQTT capability — port only; no mqtt.js dependency in the SDK.
 */
export interface MqttConnection {
  publish(topic: string, payload: Uint8Array): Promise<void>;
  subscribe(topic: string, handler: (payload: Uint8Array) => void): () => void;
  close(): Promise<void>;
}

export type MqttTransportOptions = {
  coreId: string;
  clientId: string;
  baseTopic?: string;
};

function topic(base: string, coreId: string, suffix: string): string {
  return `${base}/v1/cores/${coreId}/${suffix}`;
}

/**
 * MQTT Protocol V1 adapter (phase 370 topics). Delivers identical envelope
 * bytes to `SpaghettiClient`; no Config translation and no app-level retry.
 */
export class MqttProtocolTransport implements ProtocolTransport {
  readonly name = "mqtt";
  private readonly requestTopic: string;
  private readonly responseTopic: string;
  private readonly eventTopics: string[];
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
  private readonly unsubs: Array<() => void> = [];
  private closed = false;

  constructor(
    private readonly connection: MqttConnection,
    options: MqttTransportOptions,
  ) {
    const base = options.baseTopic ?? "spaghetti";
    this.requestTopic = topic(base, options.coreId, `requests/${options.clientId}`);
    this.responseTopic = topic(base, options.coreId, `responses/${options.clientId}`);
    this.eventTopics = [
      topic(base, options.coreId, "state"),
      topic(base, options.coreId, "catalog"),
      topic(base, options.coreId, "discovery"),
    ];
    this.unsubs.push(
      this.connection.subscribe(this.responseTopic, (payload) =>
        this.onResponse(payload),
      ),
    );
    for (const eventTopic of this.eventTopics) {
      this.unsubs.push(
        this.connection.subscribe(eventTopic, (payload) =>
          this.pushEvent(new Uint8Array(payload)),
        ),
      );
    }
  }

  async send(request: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    if (this.closed) throw new Error("mqtt transport closed");
    const copy = new Uint8Array(request);
    const correlationId = decodeRequest(copy).correlationId;
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(new Error("timeout"));
      }, timeoutMs);
      this.pending.set(correlationId, { resolve, reject, timer });
      void this.connection.publish(this.requestTopic, copy).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(correlationId);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
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
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("mqtt transport closed"));
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

  private onResponse(payload: Uint8Array): void {
    const copy = new Uint8Array(payload);
    let correlationId: number;
    try {
      correlationId = decodeResponse(copy).correlationId;
    } catch {
      return;
    }
    const pending = this.pending.get(correlationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(correlationId);
    pending.resolve(copy);
  }

  private pushEvent(bytes: Uint8Array): void {
    if (this.eventWaiters.length > 0) {
      this.eventWaiters.shift()!({ value: bytes, done: false });
    } else {
      this.eventBuffers.push(bytes);
    }
  }
}
