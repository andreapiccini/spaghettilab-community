/**
 * In-memory ProtocolTransport for unit tests.
 */
import { createHash } from "node:crypto";

import {
  boolField,
  decodeOne,
  encodeMap,
  optionalU32,
  requireBytes,
  requireMap,
  requireU32,
} from "../src/codec.js";
import { encodeCatalogPage } from "../src/catalog.js";
import {
  decodeConfig,
  emptySpaghettiConfig,
  encodeApplyConfigResponse,
  encodeConfig,
  encodeEmptyPayload,
  encodeGetConfigResponse,
  encodeGetStatusResponse,
  encodeResponse,
  encodeTopologyPage,
  decodeRequest,
} from "../src/config-codec.js";
import type { ProtocolTransport } from "../src/transport.js";
import type {
  ApplyResult,
  Catalog,
  ConfigSnapshot,
  CoreStatus,
  CoreTopology,
  ProtocolStatus,
  SpaghettiConfig,
} from "../src/types.js";
import { Operation } from "../src/types.js";

export type FakeHandler = (
  operation: number,
  payload: Uint8Array,
  correlationId: number,
) => Promise<{ status?: ProtocolStatus; payload?: Uint8Array } | Uint8Array>;

export class FakeTransport implements ProtocolTransport {
  readonly name: string;
  readonly sent: Uint8Array[] = [];
  private handler: FakeHandler;
  private readonly eventBuffers: Uint8Array[] = [];
  private readonly eventWaiters: Array<(value: IteratorResult<Uint8Array>) => void> =
    [];
  private closed = false;
  failTimes = 0;
  delayMs = 0;

  constructor(name: string, handler: FakeHandler) {
    this.name = name;
    this.handler = handler;
  }

  setHandler(handler: FakeHandler): void {
    this.handler = handler;
  }

  async send(request: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    const copy = new Uint8Array(request);
    this.sent.push(copy);
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      await new Promise((r) => setTimeout(r, Math.min(timeoutMs, 20)));
      throw new Error("timeout");
    }
    if (this.delayMs > timeoutMs) {
      await new Promise((r) => setTimeout(r, timeoutMs + 5));
      throw new Error("timeout");
    }
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    const req = decodeRequest(copy);
    const result = await this.handler(req.operation, req.payload, req.correlationId);
    let status: ProtocolStatus = "ok";
    let payload = encodeEmptyPayload();
    if (result instanceof Uint8Array) {
      payload = result;
    } else {
      status = result.status ?? "ok";
      payload = result.payload ?? encodeEmptyPayload();
    }
    return encodeResponse(req.correlationId, status, payload);
  }

  events(): AsyncIterable<Uint8Array> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
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
            return new Promise((resolve) => self.eventWaiters.push(resolve));
          },
        };
      },
    };
  }

  pushEvent(bytes: Uint8Array): void {
    if (this.eventWaiters.length > 0) {
      this.eventWaiters.shift()!({ value: bytes, done: false });
    } else {
      this.eventBuffers.push(bytes);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    while (this.eventWaiters.length > 0) {
      this.eventWaiters.shift()!({
        value: undefined as unknown as Uint8Array,
        done: true,
      });
    }
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function encodeValidValidateResponse(): Uint8Array {
  return encodeMap([boolField(0, true)]);
}

export function makeCoreState(overrides?: {
  catalog?: Catalog;
  topology?: CoreTopology;
  config?: SpaghettiConfig;
  generation?: number;
  onCatalogPage?: (cursor: number) => ReturnType<typeof encodeCatalogPage>;
}): FakeHandler {
  let config = overrides?.config ?? emptySpaghettiConfig();
  let generation = overrides?.generation ?? 1;
  let catalog =
    overrides?.catalog ??
    ({
      protocolVersion: 1,
      configVersion: 5,
      fingerprint: "11".repeat(32),
      drivers: [{ typeId: "ina219", commandCount: 1, commands: [], fields: [] }],
      driverCount: 1,
    } satisfies Catalog);
  const topology =
    overrides?.topology ??
    ({
      flows: [
        {
          id: 0,
          portId: 0,
          direction: "field_to_core",
          signalCount: 5,
          bays: [
            {
              id: 0,
              ordinalFromField: 0,
              availablePowerRails: [1],
            },
          ],
        },
      ],
      powerRails: [
        { id: 1, assurance: "unmanaged", maxTotalMicroamps: 0 },
        { id: 2, assurance: "switched", maxTotalMicroamps: 500000 },
      ],
    } satisfies CoreTopology);

  return async (operation, payload) => {
    switch (operation) {
      case Operation.GET_CATALOG: {
        if (overrides?.onCatalogPage) {
          const cursor =
            payload.length === 0
              ? 0
              : optionalU32(requireMap(decodeOne(payload), "cat"), 0, 0, "cat");
          return overrides.onCatalogPage(cursor);
        }
        return encodeCatalogPage({
          protocolVersion: catalog.protocolVersion,
          configVersion: catalog.configVersion,
          fingerprint: catalog.fingerprint,
          drivers: catalog.drivers,
          nextCursor: 0,
          driverCount: catalog.driverCount,
        });
      }
      case Operation.GET_STATUS: {
        const status: CoreStatus = {
          state: 1,
          mode: 0,
          imageState: 0,
          activeSlot: 0,
          imageConfirmed: true,
          version: "1.0.0",
          portCount: 1,
          lastResetCause: 0,
          healthState: 0,
          modules: [],
        };
        return encodeGetStatusResponse(status);
      }
      case Operation.GET_TOPOLOGY: {
        return encodeTopologyPage({
          flows: topology.flows,
          powerRails: topology.powerRails,
          nextCursor: 0,
        });
      }
      case Operation.GET_CONFIG: {
        const encoded = encodeConfig(config);
        const snapshot: ConfigSnapshot = {
          config,
          revision: { generation, sha256: sha256Hex(encoded) },
        };
        return encodeGetConfigResponse(snapshot);
      }
      case Operation.VALIDATE_CONFIG:
        return encodeValidValidateResponse();
      case Operation.APPLY_CONFIG: {
        const map = requireMap(decodeOne(payload), "apply");
        const expected = requireU32(map, 0, "apply");
        if (expected !== generation) {
          return { status: "conflict" };
        }
        const configBytes = requireBytes(map, 1, "apply");
        config = decodeConfig(configBytes);
        generation += 1;
        const result: ApplyResult = {
          changed: true,
          revision: { generation, sha256: sha256Hex(encodeConfig(config)) },
        };
        return encodeApplyConfigResponse(result);
      }
      case Operation.MODULE_COMMAND:
        return encodeEmptyPayload();
      default:
        return { status: "unsupported" };
    }
  };
}

/** Mutable catalog fingerprint for fingerprint-change tests. */
export function withMutableCatalog(initial: Catalog): {
  handler: FakeHandler;
  setFingerprint: (fp: string) => void;
} {
  let fingerprint = initial.fingerprint;
  const handler = makeCoreState({
    catalog: initial,
    onCatalogPage: (cursor) => {
      if (cursor === 0) {
        return encodeCatalogPage({
          protocolVersion: 1,
          configVersion: 5,
          fingerprint,
          drivers: initial.drivers.slice(0, 1),
          nextCursor: 1,
          driverCount: initial.drivers.length,
        });
      }
      return encodeCatalogPage({
        protocolVersion: 1,
        configVersion: 5,
        fingerprint,
        drivers: initial.drivers.slice(1),
        nextCursor: 0,
        driverCount: initial.drivers.length,
      });
    },
  });
  return {
    handler,
    setFingerprint: (fp: string) => {
      fingerprint = fp;
    },
  };
}
