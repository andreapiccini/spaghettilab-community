import { expect, it, vi } from "vitest";
import type { SpaghettiClient } from "@spaghettilab/protocol-sdk";
import { compileConfig, encodeConfigCbor } from "@spaghettilab/config-compiler";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";
import { prepareDeploymentPhysical } from "../deployment-physical.js";
vi.mock("../stop-deployed-runtime.js", async (original) => ({
  ...(await original<typeof import("../stop-deployed-runtime.js")>()),
  waitConfigWriteGap: async () => {},
}));
const compiled = compileConfig({
  physicalGraph: { layer: "physical-composition", nodes: [], edges: [] },
  processingGraph: { layer: "device-processing", nodes: [], edges: [] },
  mqtt: DISABLED_MQTT,
  connectivity: 1,
  energy: DEFAULT_ENERGY,
});
if (!compiled.ok) throw new Error("fixture");
const original = encodeConfigCbor(compiled.value);
function fixture() {
  let modes = [0, 0, 0, 0],
    bytes = original.slice(),
    generation = 1;
  let fail = false;
  const log: string[] = [];
  const peer = {
    getConfig: async () => ({
      generation,
      configBytes: bytes.slice(),
      sha256: new Uint8Array(32),
    }),
    applyConfig: async (request: {
      configBytes: Uint8Array;
      expectedGeneration: number;
    }) => {
      expect(request.expectedGeneration).toBe(generation);
      bytes = request.configBytes.slice();
      generation++;
      log.push("config");
    },
    dispose: vi.fn(),
  };
  const gateway = {
    getStatus: async () => ({
      chainPeers: [
        {
          nodeId: 10,
          local: false,
          physical: Uint8Array.from([1, 1, 1, 1, 0, 255, 0, ...modes, 0, 1]),
        },
      ],
    }),
    forCanNode: () => peer,
    applyPhysical: async (request: { modes: Uint8Array }) => {
      log.push("pins");
      if (fail) {
        fail = false;
        throw new Error("pin rifiutati");
      }
      modes = Array.from(request.modes);
      return request;
    },
  } as unknown as SpaghettiClient;
  return {
    gateway,
    peer,
    log,
    modes: () => modes,
    bytes: () => bytes,
    fail: () => {
      fail = true;
    },
  };
}
const request = { nodeId: 10, modes: new Uint8Array([12, 12, 12, 0]), i2cSpeed: 0 };
it("configures replacement pins and can restore both the old pins and program", async () => {
  const board = fixture();
  const tx = await prepareDeploymentPhysical(
    board.gateway,
    [request],
    new AbortController().signal,
    () => {},
  );
  expect(board.modes()).toEqual([12, 12, 12, 0]);
  await tx.rollback();
  expect(board.modes()).toEqual([0, 0, 0, 0]);
  expect(board.bytes()).toEqual(original);
  tx.dispose();
  expect(board.peer.dispose).toHaveBeenCalledOnce();
});
it("does not rewrite matching pins and retains confirmed settings after commit", async () => {
  const board = fixture();
  const tx = await prepareDeploymentPhysical(
    board.gateway,
    [request],
    new AbortController().signal,
    () => {},
  );
  tx.commit();
  await tx.rollback();
  tx.dispose();
  const count = board.log.length;
  const same = await prepareDeploymentPhysical(
    board.gateway,
    [request],
    new AbortController().signal,
    () => {},
  );
  expect(board.log.length).toBe(count);
  same.dispose();
  expect(board.modes()).toEqual([12, 12, 12, 0]);
});
it("restores the original program if configuring a replacement pin map fails", async () => {
  const board = fixture();
  board.fail();
  await expect(
    prepareDeploymentPhysical(
      board.gateway,
      [request],
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow("pin rifiutati");
  expect(board.modes()).toEqual([0, 0, 0, 0]);
  expect(board.bytes()).toEqual(original);
  expect(board.peer.dispose).toHaveBeenCalledOnce();
});

it("accepts an eight-pin project on a four-pin board when the extra pins are unused", async () => {
  const board = fixture();
  const tx = await prepareDeploymentPhysical(
    board.gateway,
    [{ ...request, modes: new Uint8Array([12, 12, 12, 0, 0, 0, 0, 0]) }],
    new AbortController().signal,
    () => {},
  );
  expect(board.modes()).toEqual([12, 12, 12, 0]);
  tx.commit();
  tx.dispose();
});
it("refuses to drop a configured upper pin before changing any hardware", async () => {
  const board = fixture();
  await expect(
    prepareDeploymentPhysical(
      board.gateway,
      [{ ...request, modes: new Uint8Array([0, 0, 0, 0, 2, 0, 0, 0]) }],
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow(/A4–A7/);
  expect(board.log).toEqual([]);
});
