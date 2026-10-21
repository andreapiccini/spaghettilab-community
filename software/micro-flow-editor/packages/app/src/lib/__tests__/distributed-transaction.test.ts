import { expect, it, vi } from "vitest";
import type { SpaghettiClient } from "@spaghettilab/protocol-sdk";
import { compileConfig, encodeConfigCbor } from "@spaghettilab/config-compiler";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";
import { prepareRemoteDeployment, type RemotePlan } from "../distributed-deployment.js";
vi.mock("../stop-deployed-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../stop-deployed-runtime.js")>()),
  waitConfigWriteGap: async () => {},
}));
const input = {
  physicalGraph: { layer: "physical-composition" as const, nodes: [], edges: [] },
  processingGraph: { layer: "device-processing" as const, nodes: [], edges: [] },
  mqtt: DISABLED_MQTT,
  connectivity: 0,
  energy: DEFAULT_ENERGY,
};
const compiled = compileConfig(input);
if (!compiled.ok) throw new Error("fixture");
const originalBytes = encodeConfigCbor(compiled.value);
const remote = (nodeId: number): RemotePlan => ({
  nodeId,
  label: `Scheda ${nodeId}`,
  plan: {
    profiles: [],
    options: {},
    input: {
      ...input,
      physicalGraph: {
        ...input.physicalGraph,
        nodes: [
          {
            layer: "physical-composition",
            id: "route",
            data: {
              kind: "module",
              driverTypeId: "can-link",
              portId: 0,
              bayId: 255,
              railId: 255,
              electricalMode: "input-output",
              properties: { "1": 100n, "2": 1n },
            },
          },
        ],
      },
    },
  },
});
class Board {
  generation = 1;
  bytes = originalBytes.slice();
  writes = 0;
  disposed = false;
  fail = false;
  loseReply = false;
  constructor(
    readonly node: number,
    readonly log: string[],
  ) {}
  identity() {
    const id = new Uint8Array(32);
    id[0] = 0x90;
    id[1] = 0x70;
    id[2] = 0x69;
    id[3] = this.node >>> 16;
    id[4] = this.node >>> 8;
    id[5] = this.node;
    return id;
  }
  async getStatus() {
    return { version: "0.5.49", deviceId: this.identity() };
  }
  async getCapabilities() {
    return { coreVariant: "backbone-v2-esp32s3" };
  }
  async getConfig() {
    return {
      generation: this.generation,
      sha256: new Uint8Array(32),
      configBytes: this.bytes.slice(),
    };
  }
  async validateConfig() {
    this.log.push(`validate:${this.node}`);
    return { valid: true as const };
  }
  async applyConfig(req: { expectedGeneration: number; configBytes: Uint8Array }) {
    this.log.push(`apply:${this.node}`);
    if (this.fail) throw new Error("scrittura rifiutata");
    if (req.expectedGeneration !== this.generation) throw new Error("conflitto");
    this.bytes = req.configBytes.slice();
    this.generation++;
    this.writes++;
    if (this.loseReply) {
      this.loseReply = false;
      throw new Error("risposta persa");
    }
    return { changed: true, generation: this.generation, sha256: new Uint8Array(32) };
  }
  async getFullDeviceProfileList() {
    return [];
  }
  dispose() {
    this.disposed = true;
  }
}
function gateway(boards: Board[]) {
  return {
    async getStatus() {
      return {
        chainPeers: boards.map((b) => ({
          nodeId: b.node,
          mac: b.identity().slice(0, 6),
          local: false,
        })),
      };
    },
    forCanNode: (node: number) => boards.find((b) => b.node === node)!,
  } as unknown as SpaghettiClient;
}
it("validates every board before applying and restores an earlier board after a later failure", async () => {
  const log: string[] = [],
    a = new Board(1, log),
    b = new Board(2, log);
  b.fail = true;
  const tx = await prepareRemoteDeployment(
    gateway([a, b]),
    [remote(1), remote(2)],
    new AbortController().signal,
    () => {},
    false,
  );
  expect(a.writes + b.writes).toBe(0);
  expect(log).toEqual(["validate:1", "validate:2"]);
  await expect(tx.apply()).rejects.toThrow("Scheda 2");
  expect(a.writes).toBe(1);
  await tx.rollback();
  expect(a.bytes).toEqual(originalBytes);
  expect(a.writes).toBe(2);
  expect(b.writes).toBe(0);
  tx.dispose();
  expect(a.disposed && b.disposed).toBe(true);
});
it("accepts a lost apply reply only after exact read-back and can still restore the previous program", async () => {
  const board = new Board(1, []);
  board.loseReply = true;
  const tx = await prepareRemoteDeployment(
    gateway([board]),
    [remote(1)],
    new AbortController().signal,
    () => {},
    false,
  );
  await tx.apply();
  expect(board.writes).toBe(1);
  expect(board.bytes).not.toEqual(originalBytes);
  await tx.rollback();
  expect(board.bytes).toEqual(originalBytes);
  tx.dispose();
});
it("does not overwrite a configuration changed by another actor before rollback", async () => {
  const board = new Board(1, []);
  const tx = await prepareRemoteDeployment(
    gateway([board]),
    [remote(1)],
    new AbortController().signal,
    () => {},
    false,
  );
  await tx.apply();
  board.generation++;
  await expect(tx.rollback()).rejects.toThrow("cambiata nel frattempo");
  expect(board.writes).toBe(1);
  tx.dispose();
});
it("a confirmed commit is never rolled back by final cleanup", async () => {
  const board = new Board(1, []);
  const tx = await prepareRemoteDeployment(
    gateway([board]),
    [remote(1)],
    new AbortController().signal,
    () => {},
    false,
  );
  await tx.apply();
  await tx.commit("project", 100, { input, profiles: [], options: {} });
  await tx.rollback();
  expect(board.writes).toBe(1);
  tx.dispose();
});

it("ignores participants from an older deployment when the live program has no CAN routes", async () => {
  const { pauseDistributedParticipants } = await import("../distributed-deployment.js");
  const getItem = vi.fn(() => JSON.stringify({ participants: [{ nodeId: 0xe1c4fc, completionProfiles: [] }] }));
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", { getItem, setItem });
  try {
    const gateway = {
      getStatus: vi.fn(async () => ({ deviceId: new Uint8Array([0x90,0x70,0x69,0xe1,0x80,0x40]), chainPeers: [] })),
      getConfig: vi.fn(async () => ({ configBytes: originalBytes, generation: 1 })),
      forCanNode: vi.fn(),
    };
    await pauseDistributedParticipants(gateway as unknown as SpaghettiClient, "project", new AbortController().signal, () => {});
    expect(gateway.forCanNode).not.toHaveBeenCalled();
    expect(JSON.parse(setItem.mock.calls[0]![1]).participants).toEqual([]);
  } finally { vi.unstubAllGlobals(); }
});
