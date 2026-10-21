import { describe, it, expect } from "vitest";
import { SpaghettiClient } from "../spaghetti-client.js";
import { FakeTransport } from "../fakes/fake-transport.js";
import {
  decodeRequest,
  encodeResponse,
  ProtocolStatus,
  Operation,
} from "../../envelope.js";
import { decodeOne } from "../../cbor.js";
import {
  encodeMap,
  boolField,
  bytesField,
  u32Field,
  requireMap,
  requireU32,
  requireBytes,
} from "../../fields.js";
import {
  encodeGetConfigRequest,
  decodeGetConfigRequest,
  encodeGetConfigResponse,
} from "../../operations/config.js";

class Server extends FakeTransport {
  constructor(
    private readonly reply: (operation: Operation, payload: Uint8Array) => Uint8Array,
  ) {
    super();
  }
  override async send(bytes: Uint8Array) {
    await super.send(bytes);
    const req = decodeRequest(bytes);
    this.deliverResponse(
      encodeResponse({
        correlationId: req.correlationId,
        status: ProtocolStatus.OK,
        payload: this.reply(req.operation, req.payload),
      }),
    );
  }
}
describe("configuration chunk transfer", () => {
  it("decodes an optional config read offset and rejects unknown fields", () => {
    expect(decodeGetConfigRequest(encodeGetConfigRequest())).toBeUndefined();
    expect(decodeGetConfigRequest(encodeGetConfigRequest(400))).toBe(400);
    expect(() => decodeGetConfigRequest(encodeMap([u32Field(9, 400)]))).toThrow();
  });
  it("uploads a 1024 byte configuration in ordered bounded chunks and preserves CAS", async () => {
    const original = Uint8Array.from({ length: 1024 }, (_, i) => i % 251);
    const received = new Uint8Array(1024);
    let offset = 0;
    let token = 0;
    const transport = new Server((op, payload) => {
      expect(op).toBe(Operation.APPLY_CONFIG);
      expect(payload.length).toBeLessThan(480);
      const map = requireMap(decodeOne(payload), "chunk");
      expect(requireU32(map, 0, "chunk")).toBe(17);
      expect(requireU32(map, 11, "chunk")).toBe(offset);
      expect(requireU32(map, 12, "chunk")).toBe(1024);
      const nextToken = requireU32(map, 10, "chunk");
      if (token) expect(nextToken).toBe(token);
      token = nextToken;
      const chunk = requireBytes(map, 1, "chunk");
      received.set(chunk, offset);
      offset += chunk.length;
      return offset < 1024
        ? encodeMap([])
        : encodeMap([
            boolField(0, true),
            u32Field(1, 18),
            bytesField(2, new Uint8Array(32)),
          ]);
    });
    const client = new SpaghettiClient(transport);
    expect(
      (await client.applyConfig({ expectedGeneration: 17, configBytes: original }))
        .generation,
    ).toBe(18);
    expect(received).toEqual(original);
    expect(transport.sent).toHaveLength(3);
    client.dispose();
  });
  it("assembles chunks only from the same revision", async () => {
    const data = Uint8Array.from({ length: 1024 }, (_, i) => i % 251);
    const client = new SpaghettiClient(
      new Server((_op, payload) => {
        const map = requireMap(decodeOne(payload), "request");
        const offset = map.has(0) ? requireU32(map, 0, "request") : 0;
        return encodeGetConfigResponse({
          generation: 7,
          sha256: new Uint8Array(32),
          configBytes: data.slice(offset, offset + 400),
          totalSize: data.length,
          offset,
        });
      }),
    );
    expect((await client.getConfig()).configBytes).toEqual(data);
    client.dispose();
  });
  it("rejects changed revisions instead of returning mixed configuration bytes", async () => {
    const client = new SpaghettiClient(
      new Server((_op, payload) => {
        const map = requireMap(decodeOne(payload), "request");
        const offset = map.has(0) ? requireU32(map, 0, "request") : 0;
        return encodeGetConfigResponse({
          generation: offset ? 8 : 7,
          sha256: new Uint8Array(32),
          configBytes: new Uint8Array(400),
          totalSize: 800,
          offset,
        });
      }),
    );
    await expect(client.getConfig()).rejects.toThrow("changed");
    client.dispose();
  });
});
