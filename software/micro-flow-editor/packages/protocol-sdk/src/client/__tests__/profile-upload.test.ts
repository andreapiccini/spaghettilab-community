import { it, expect } from "vitest";
import { requireMap, requireBytes, requireU32 } from "../../fields.js";
import { SpaghettiClient } from "../spaghetti-client.js";
import { FakeTransport } from "../fakes/fake-transport.js";
import {
  decodeRequest,
  encodeResponse,
  ProtocolStatus,
  Operation,
} from "../../envelope.js";
import { encodeMap, encodeUint, decodeOne } from "../../cbor.js";

it.each([false, true])(
  "uploads large profiles through bounded packets: install=%s",
  async (install) => {
    class ReplyingTransport extends FakeTransport {
      override send(bytes: Uint8Array) {
        super.send(bytes);
        const request = decodeRequest(bytes);
        queueMicrotask(() =>
          this.deliverResponse(
            encodeResponse({
              correlationId: request.correlationId,
              status: ProtocolStatus.OK,
              payload: install ? encodeMap([]) : encodeMap([[0, encodeUint(1n)]]),
            }),
          ),
        );
        return Promise.resolve();
      }
    }
    const transport = new ReplyingTransport(),
      client = new SpaghettiClient(transport);
    try {
      const data = Uint8Array.from({ length: 2301 }, (_, i) => i % 256);
      if (install) await client.installDeviceProfile({ profileCbor: data });
      else
        expect((await client.validateDeviceProfile({ profileCbor: data })).valid).toBe(
          1,
        );
      const combined: number[] = [],
        tokens: number[] = [];
      for (const bytes of transport.sent) {
        const request = decodeRequest(bytes);
        expect(request.operation).toBe(
          install
            ? Operation.INSTALL_DEVICE_PROFILE
            : Operation.VALIDATE_DEVICE_PROFILE,
        );
        expect(request.payload.length).toBeLessThan(512);
        const map = requireMap(decodeOne(request.payload), "upload");
        expect(requireU32(map, 1, "upload")).toBe(combined.length);
        expect(requireU32(map, 2, "upload")).toBe(data.length);
        tokens.push(requireU32(map, 3, "upload"));
        combined.push(...requireBytes(map, 0, "upload"));
      }
      expect(new Set(tokens).size).toBe(1);
      expect(new Uint8Array(combined)).toEqual(data);
      expect(transport.sent).toHaveLength(6);
    } finally {
      client.dispose();
    }
  },
);
