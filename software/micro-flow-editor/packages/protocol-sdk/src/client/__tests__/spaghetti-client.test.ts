import { encodeMap, encodeInt, encodeText } from "../../cbor.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeRequest,
  encodeEvent,
  encodeResponse,
  EventType,
  ProtocolStatus,
} from "../../envelope.js";
import { encodeStatusEventPayload } from "../../events.js";
import {
  encodeGetCatalogResponse,
  encodeGetStatusResponse,
  type GetStatusResponse,
} from "../../operations/index.js";
import { FakeTransport } from "../fakes/fake-transport.js";
import { SpaghettiClient } from "../spaghetti-client.js";

const STATUS_FIXTURE: GetStatusResponse = {
  state: 1,
  mode: 1,
  imageState: 0,
  activeSlot: 0,
  imageConfirmed: true,
  version: "1.0.0",
  portCount: 1,
  lastResetCause: 0,
  healthState: 1,
  modules: [],
};

function respondOkToLastRequest(transport: FakeTransport, payload: Uint8Array): void {
  const lastSent = transport.sent.at(-1);
  if (!lastSent) throw new Error("no request was sent");
  const request = decodeRequest(lastSent);
  transport.deliverResponse(
    encodeResponse({
      correlationId: request.correlationId,
      status: ProtocolStatus.OK,
      payload,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SpaghettiClient — basic round trip", () => {
  it("resolves getStatus when a matching response arrives", async () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport);

    const promise = client.getStatus();
    expect(transport.sent).toHaveLength(1);
    respondOkToLastRequest(transport, encodeGetStatusResponse(STATUS_FIXTURE));

    await expect(promise).resolves.toEqual(STATUS_FIXTURE);
  });

  it("assigns a distinct correlation ID to each concurrent call", () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport);

    void client.getStatus();
    void client.getStatus();

    expect(transport.sent).toHaveLength(2);
    const first = decodeRequest(transport.sent[0]!);
    const second = decodeRequest(transport.sent[1]!);
    expect(first.correlationId).not.toBe(second.correlationId);
  });
});

describe("SpaghettiClient — retry reuses the correlation ID", () => {
  it("retries with the exact same correlation ID after a timeout, never a fresh one", async () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport, {
      defaultTimeoutMs: 10_000,
      attemptTimeoutMs: 500,
      retryDelayMs: 100,
      maxRetries: 2,
    });

    const promise = client.getStatus();
    const firstCorrelationId = decodeRequest(transport.sent[0]!).correlationId;

    // First attempt: let it time out without a response.
    await vi.advanceTimersByTimeAsync(500);
    // Retry delay, then the retry send happens.
    await vi.advanceTimersByTimeAsync(100);

    expect(transport.sent.length).toBeGreaterThanOrEqual(2);
    const retryCorrelationId = decodeRequest(transport.sent.at(-1)!).correlationId;
    expect(retryCorrelationId).toBe(firstCorrelationId);

    respondOkToLastRequest(transport, encodeGetStatusResponse(STATUS_FIXTURE));
    await expect(promise).resolves.toEqual(STATUS_FIXTURE);
  });

  it("rejects with TIMEOUT once retries are exhausted, never resolving silently", async () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport, {
      defaultTimeoutMs: 1000,
      retryDelayMs: 10,
      maxRetries: 1,
    });

    const promise = client.getStatus();
    promise.catch(() => {}); // avoid unhandled-rejection noise while advancing timers below
    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("SpaghettiClient — non-OK status surfaces immediately, no retry", () => {
  it("rejects with PROTOCOL_ERROR on the first CONFLICT response, without sending a second request", async () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport, {
      defaultTimeoutMs: 10_000,
      retryDelayMs: 500,
    });

    const promise = client.applyConfig({
      expectedGeneration: 1,
      configBytes: new Uint8Array([0xa0]),
    });
    const correlationId = decodeRequest(transport.sent[0]!).correlationId;
    transport.deliverResponse(
      encodeResponse({
        correlationId,
        status: ProtocolStatus.CONFLICT,
        payload: new Uint8Array(),
      }),
    );

    await expect(promise).rejects.toMatchObject({
      code: "PROTOCOL_ERROR",
      status: ProtocolStatus.CONFLICT,
    });
    expect(transport.sent).toHaveLength(1);
  });
});

describe("SpaghettiClient — reboot detection", () => {
  it("rejects a pending request with REBOOT_DURING_REQUEST when a STATUS event reports a changed boot ID, instead of retrying across it", async () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport, { defaultTimeoutMs: 10_000 });

    // Establish the initial boot ID via a STATUS event.
    transport.deliverEvent(
      encodeEvent({
        sequence: 1,
        type: EventType.STATUS,
        payload: encodeStatusEventPayload({
          deviceId: new Uint8Array([1]),
          bootId: 1n,
          queueDepth: 0,
          dropCount: 0,
        }),
      }),
    );

    const promise = client.getStatus();
    promise.catch(() => {});
    expect(transport.sent).toHaveLength(1);

    // Reboot: boot ID changes.
    transport.deliverEvent(
      encodeEvent({
        sequence: 2,
        type: EventType.STATUS,
        payload: encodeStatusEventPayload({
          deviceId: new Uint8Array([1]),
          bootId: 2n,
          queueDepth: 0,
          dropCount: 0,
        }),
      }),
    );

    await expect(promise).rejects.toMatchObject({ code: "REBOOT_DURING_REQUEST" });
    // No blind resend must have happened as a result of the reboot itself.
    expect(transport.sent).toHaveLength(1);
  });
});

describe("SpaghettiClient — catalog pagination restarts on fingerprint change", () => {
  it("discards partial pages and restarts from cursor 0 when the fingerprint changes mid-read", async () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport, { defaultTimeoutMs: 10_000 });

    const fingerprintA = new Uint8Array(32).fill(1);
    const fingerprintB = new Uint8Array(32).fill(2);

    const resultPromise = client.getFullCatalog(1);

    // Page 1 of read attempt #1: fingerprint A, one driver, more pages follow.
    respondOkToLastRequest(
      transport,
      encodeGetCatalogResponse({
        protocolVersion: 1,
        configVersion: 5,
        fingerprint: fingerprintA,
        drivers: [{ typeId: "driver-a", commandCount: 1 }],
        nextCursor: 1,
        driverCount: 2,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // Page 2 of read attempt #1: fingerprint changed to B — must restart.
    respondOkToLastRequest(
      transport,
      encodeGetCatalogResponse({
        protocolVersion: 1,
        configVersion: 5,
        fingerprint: fingerprintB,
        drivers: [{ typeId: "driver-b", commandCount: 1 }],
        nextCursor: 0,
        driverCount: 1,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    // Read attempt #2, page 1: fingerprint B throughout, completes cleanly.
    respondOkToLastRequest(
      transport,
      encodeGetCatalogResponse({
        protocolVersion: 1,
        configVersion: 5,
        fingerprint: fingerprintB,
        drivers: [{ typeId: "driver-b", commandCount: 1 }],
        nextCursor: 0,
        driverCount: 1,
      }),
    );

    const result = await resultPromise;
    expect(result.fingerprint).toEqual(fingerprintB);
    expect(result.drivers).toEqual([{ typeId: "driver-b", commandCount: 1 }]);
  });
});

describe("SpaghettiClient — malformed/extra-key/oversized responses are dropped safely", () => {
  it("ignores an undecodable response instead of crashing, and the call eventually times out", async () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport, {
      defaultTimeoutMs: 500,
      retryDelayMs: 10,
      maxRetries: 0,
    });

    const promise = client.getStatus();
    promise.catch(() => {});

    expect(() =>
      transport.deliverResponse(new Uint8Array([0xff, 0xff, 0xff])),
    ).not.toThrow();

    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("ignores a response with an unexpected envelope key (>3) instead of crashing", async () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport, {
      defaultTimeoutMs: 500,
      retryDelayMs: 10,
      maxRetries: 0,
    });

    const promise = client.getStatus();
    promise.catch(() => {});
    const correlationId = decodeRequest(transport.sent[0]!).correlationId;

    // {0:1,1:correlationId,2:0,3:h'',4:0} — key 4 is not allowed on the wire.
    const extraKeyBytes = new Uint8Array([
      0xbf,
      0x00,
      0x01,
      0x01,
      ...encodeU32Field(correlationId),
      0x02,
      0x00,
      0x03,
      0x40,
      0x04,
      0x00,
      0xff,
    ]);
    expect(() => transport.deliverResponse(extraKeyBytes)).not.toThrow();

    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("SpaghettiClient — cancellation", () => {
  it("rejects with CANCELLED when the AbortSignal fires before a response arrives", async () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport, { defaultTimeoutMs: 10_000 });
    const controller = new AbortController();

    const promise = client.getStatus(controller.signal);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("rejects immediately if the signal is already aborted before the call starts", async () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport);
    const controller = new AbortController();
    controller.abort();

    await expect(client.getStatus(controller.signal)).rejects.toMatchObject({
      code: "CANCELLED",
    });
    expect(transport.sent).toHaveLength(0);
  });
});

describe("SpaghettiClient — dispose", () => {
  it("rejects every pending call with CANCELLED", async () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport, { defaultTimeoutMs: 10_000 });

    const promise = client.getStatus();
    client.dispose();

    await expect(promise).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

/** Minimal helper for hand-building one malformed envelope test vector above. */
function encodeU32Field(value: number): number[] {
  if (value < 24) return [value];
  if (value <= 0xff) return [0x18, value];
  if (value <= 0xffff) return [0x19, (value >> 8) & 0xff, value & 0xff];
  return [
    0x1a,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

describe("APPLY_CONFIG failure diagnostics", () => {
  it.each([
    [
      encodeMap([
        [0, encodeInt(-5n)],
        [1, encodeText("activate_module")],
        [2, encodeInt(0n)],
      ]),
      { errno: -5, phase: "activate_module", rollbackErrno: 0 },
    ],
    [new Uint8Array(), undefined],
    [new Uint8Array([0xff]), undefined],
    [encodeMap([[0, encodeText("invalid")]]), undefined],
  ])(
    "preserves protocol errors and accepts optional diagnostics",
    async (payload, configFailure) => {
      const transport = new FakeTransport();
      const client = new SpaghettiClient(transport);
      const promise = client.applyConfig({
        expectedGeneration: 1,
        configBytes: new Uint8Array([0xa0]),
      });
      const assertion = expect(promise).rejects.toMatchObject({
        code: "PROTOCOL_ERROR",
        status: ProtocolStatus.INTERNAL_ERROR,
        configFailure,
      });
      const request = decodeRequest(transport.sent[0]!);
      transport.deliverResponse(
        encodeResponse({
          correlationId: request.correlationId,
          status: ProtocolStatus.INTERNAL_ERROR,
          payload,
        }),
      );
      await assertion;
      client.dispose();
    },
  );
});
