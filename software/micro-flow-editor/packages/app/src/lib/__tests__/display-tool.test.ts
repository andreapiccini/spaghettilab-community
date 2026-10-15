import { describe, expect, it, vi } from "vitest";
import type { SpaghettiClient } from "@spaghettilab/protocol-sdk";
import { decodeConfigCbor } from "@spaghettilab/config-decompiler";
import { encodeDeviceProfileCbor } from "@spaghettilab/device-profile-install";
import {
  addCommand,
  createBlankDraft,
  renameRecipeVariable,
  DEVICE_RECIPE_DRAFT_META_KEY,
} from "../device-recipe-draft.js";
import { addFlowInterface } from "../flow-interfaces.js";
import {
  createDisplayTool,
  compileDisplayProgram,
  displayAdapterOutputs,
  displayFrame,
  displayProgramAction,
  parseDisplayTools,
  rasterDisplay,
  type DisplayToolProject,
} from "../display-tool.js";
import {
  evaluateAdapterExpression as evaluate,
  packAdapterValue,
} from "../display-adapter-expression.js";
import { compileDisplayRuntime, runDisplayProgram } from "../display-tool-runtime.js";
import { savedDeviceDrivers, saveDriverMetadata } from "../device-driver-library.js";
import { buildRecipeTestConfigBytes } from "../recipe-to-test-profile.js";
import { withExclusiveRecipeHardwareTest } from "../recipe-hardware-test.js";

function fixture() {
  const input = addFlowInterface(
    addCommand(createBlankDraft("i2c", "Display creato"), { label: "Invia byte" }),
    "sample_external",
  );
  const driver = {
    ...input.draft,
    binding: {
      ...input.draft.binding,
      i2c: { ...input.draft.binding.i2c!, address: "0x3C" },
    },
    commands: input.draft.commands.map((action) => ({
      ...action,
      steps: [{ id: "send", type: "i2c_write" as const, bytes: ["40", "$var1"] }],
    })),
  };
  const variable = driver.variables[0]!;
  const project: DisplayToolProject = {
    ...createDisplayTool(),
    driverId: driver.id,
    width: 16,
    height: 8,
    elements: [
      {
        id: "line",
        kind: "line",
        x1: 0,
        y1: 0,
        x2: 15,
        y2: 0,
        color: 1,
        text: "",
        filled: false,
      },
    ],
    adapter: {
      line: [
        {
          id: "map",
          actionId: driver.commands[0]!.id,
          inputs: [
            {
              variableId: variable.id,
              expression: "bytes(x1, y1, x2, y2)",
              width: 1,
              byteOrder: "be",
            },
          ],
          outputs: [],
          repeat: "once",
          chunkSize: 8,
        },
      ],
    },
  };
  return { driver, variable, project };
}
describe("manual display adapter expressions", () => {
  it.each([
    ["(x1 >> 8) & 255", 0x12],
    ["lo(x1)", 0x34],
    ["hi(x1)", 0x12],
    ["round(x1 / 100)", 47],
    ["clamp(-1, 0, 10)", 0],
    ["rx0[0] + 256 * rx0[1]", 0x1234],
    ["0b1010 | 0x01", 11],
  ])("evaluates %s", (formula, expected) =>
    expect(evaluate(formula, { x1: 0x1234, rx0: [0x34, 0x12] })).toBe(expected),
  );
  it("supports byte packing, text encoding, concatenation and frame slicing", () => {
    expect(
      evaluate("concat(bytes(0x40), le16(x1), slice(frame, 1, 2))", {
        x1: 0x1234,
        frame: [1, 2, 3, 4],
      }),
    ).toEqual([0x40, 0x34, 0x12, 2, 3]);
    expect(evaluate('ascii("L" + x1 + "," + y1)', { x1: 2, y1: 5 })).toEqual([
      76, 50, 44, 53,
    ]);
    expect(evaluate("utf8(text)", { text: "è" })).toEqual([0xc3, 0xa8]);
    expect(packAdapterValue(-1, 2, "be")).toEqual([255, 255]);
  });
  it.each([
    "globalThis.fetch('https://example.com')",
    "constructor('return 1')()",
    "frame.constructor",
    "1/0",
    "bytes(256)",
    "rx0[2]",
  ])("rejects unsafe or invalid formula %s", (formula) =>
    expect(() => evaluate(formula, { frame: [1], rx0: [0] })).toThrow(),
  );
  it("does not silently truncate values", () => {
    expect(() => packAdapterValue(256, 1, "le")).toThrow("non entra");
    expect(() => packAdapterValue(1.5, 2, "le")).toThrow("intero esatto");
  });
});
describe("display programs and driver mapping", () => {
  it("requires explicit mappings and substitutes coordinates into the chosen driver action", () => {
    const { driver, project } = fixture();
    const calls = compileDisplayProgram(project, driver);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.steps[0]).toMatchObject({
      type: "i2c_write",
      bytes: ["40", "00", "00", "0F", "00"],
    });
    expect(() => compileDisplayProgram({ ...project, adapter: {} }, driver)).toThrow(
      "Mappa la funzione",
    );
    expect(() =>
      compileDisplayProgram({ ...project, driverId: "other" }, driver),
    ).toThrow("driver associato");
  });
  it("preserves adapter bindings when driver variables or actions are renamed", () => {
    const { driver, project, variable } = fixture();
    const renamed = renameRecipeVariable(driver, variable.id, "coordinate");
    expect(compileDisplayProgram(project, renamed)[0]!.steps).toEqual(
      compileDisplayProgram(project, driver)[0]!.steps,
    );
  });
  it("packs pages vertically or rows horizontally and streams them through one reusable action", () => {
    const { driver, project, variable } = fixture();
    expect(displayFrame(project)).toEqual(Array(16).fill(1));
    expect(displayFrame({ ...project, packing: "rows" })).toEqual([
      255,
      255,
      ...Array(14).fill(0),
    ]);
    const frameProject: DisplayToolProject = {
      ...project,
      adapter: {
        flush: [
          {
            id: "flush",
            actionId: driver.commands[0]!.id,
            inputs: [
              {
                variableId: variable.id,
                expression: "chunk",
                width: 1,
                byteOrder: "be",
              },
            ],
            outputs: [],
            repeat: "frame-chunks",
            chunkSize: 8,
          },
        ],
      },
    };
    const calls = compileDisplayProgram(frameProject, driver);
    expect(calls).toHaveLength(2);
    expect(
      calls.every(
        (call) =>
          call.steps[0]?.type === "i2c_write" && call.steps[0].bytes.length === 9,
      ),
    ).toBe(true);
    const runtime = compileDisplayRuntime(driver, calls, false);
    expect(runtime.profile.actions).toHaveLength(1);
    expect(runtime.requests).toHaveLength(2);
    expect(runtime.requests[0]!.arguments).toEqual({
      1: new Uint8Array([0x40, 1, 1, 1, 1, 1, 1, 1]),
      2: new Uint8Array([1]),
    });
    expect(
      runtime.profile.sampleOps.filter((op) => op.op === "I2C_WRITE"),
    ).toHaveLength(1);
    expect(() => encodeDeviceProfileCbor(runtime.profile)).not.toThrow();
  });
  it("uses actual RX bytes in output conversions and fails when a byte is missing", () => {
    const { driver, project } = fixture();
    const call = {
      ...compileDisplayProgram(project, driver)[0]!,
      outputs: [{ name: "status", expression: "rx0[0] + 256 * rx0[1]" }],
    };
    expect(displayAdapterOutputs(call, [[0x34, 0x12]])).toEqual({ status: 0x1234 });
    expect(() => displayAdapterOutputs(call, [[1]])).toThrow("Indice");
  });
  it("rasterizes and clips line/rectangle/text primitives consistently", () => {
    const { project } = fixture();
    const pixels = rasterDisplay({
      ...project,
      elements: [
        ...project.elements,
        {
          id: "box",
          kind: "rect",
          x1: 1,
          y1: 1,
          x2: 3,
          y2: 3,
          color: 1,
          text: "",
          filled: true,
        },
      ],
    });
    expect([...pixels].reduce((sum, pixel) => sum + pixel, 0)).toBe(25);
    expect(() => rasterDisplay({ ...project, width: 0 })).toThrow("Dimensioni");
    expect(
      rasterDisplay({
        ...project,
        elements: [{ ...project.elements[0]!, kind: "text", text: "A", x1: 0, y1: 0 }],
      }).some((pixel) => pixel === 1),
    ).toBe(true);
  });
  it("generates concrete driver steps and reloads saved display documents", () => {
    const { driver, project } = fixture();
    const action = displayProgramAction(project, driver);
    expect(action.steps[0]).toMatchObject({
      type: "i2c_write",
      bytes: ["40", "00", "00", "0F", "00"],
    });
    expect(parseDisplayTools(JSON.stringify([project]))).toEqual([project]);
    expect(parseDisplayTools("bad")).toEqual([]);
  });
  it("keeps multiple created drivers and discovers legacy project drivers", () => {
    const { driver } = fixture();
    const second = { ...driver, id: "another", name: "Altro" };
    const metadata = saveDriverMetadata(saveDriverMetadata({}, driver), second);
    expect(
      savedDeviceDrivers(metadata)
        .map((item) => item.id)
        .sort(),
    ).toEqual([driver.id, second.id].sort());
    expect(
      savedDeviceDrivers({
        [DEVICE_RECIPE_DRAFT_META_KEY]: { comment: JSON.stringify(driver) },
      }),
    ).toHaveLength(1);
  });
});

describe("display hardware session", () => {
  it.each(["ok", "command-error", "abort", "restore-error"] as const)(
    "applies once and restores once, even after a command failure: %s",
    async (mode) => {
      vi.useFakeTimers();
      try {
        const { driver, project } = fixture(),
          calls = compileDisplayProgram(project, driver);
        const original = buildRecipeTestConfigBytes({
          profileId: "original",
          profileVersion: 1,
          periodMs: null,
        })!;
        let configBytes = original,
          generation = 1;
        const events: string[] = [];
        const controller = new AbortController();
        const client = {
          getConfig: async () => ({
            generation,
            configBytes,
            sha256: new Uint8Array(32),
          }),
          getFullDeviceProfileList: async () => [],
          validateConfig: async () => ({ valid: true }),
          getStatus: async () => ({
            chainPeers: [
              {
                local: true,
                nodeId: 0,
                physical: new Uint8Array([1, 1, 2, 1, 0, 1, 0, 4, 5, 0, 0, 0, 1]),
              },
            ],
          }),
          applyConfig: async (request: { configBytes: Uint8Array }) => {
            const restoring =
              request.configBytes.length === original.length &&
              request.configBytes.every((byte, index) => byte === original[index]);
            if (restoring && mode === "restore-error") {
              events.push("restore");
              throw new Error("flash full");
            }
            configBytes = request.configBytes;
            generation++;
            events.push(
              configBytes.length === original.length &&
                configBytes.every((byte, index) => byte === original[index])
                ? "restore"
                : "apply",
            );
            return { changed: true, generation, sha256: new Uint8Array(32) };
          },
          moduleCommand: async () => {
            events.push("command");
            if (mode === "command-error") throw new Error("NACK");
            return { rxReads: [new Uint8Array([7])] };
          },
        } as unknown as SpaghettiClient;
        const promise = runDisplayProgram({
          client,
          driver,
          calls: mode === "abort" ? [...calls, ...calls] : calls,
          signal: controller.signal,
          onProgress: () => {
            if (mode === "abort") controller.abort();
          },
          withInit: false,
          installProfile: async () => {
            events.push("install");
          },
          removeProfile: async () => {
            events.push("remove");
          },
        }).then(
          () => null,
          (error) => error as Error,
        );
        await vi.runAllTimersAsync();
        const error = await promise;
        if (mode === "command-error") expect(error?.message).toBe("NACK");
        else if (mode === "abort") expect(error?.name).toBe("AbortError");
        else if (mode === "restore-error")
          expect(error?.message).toContain("Ripristino");
        else expect(error).toBeNull();
        expect(events).toEqual([
          "install",
          "apply",
          "command",
          "restore",
          ...(mode === "restore-error" ? [] : ["remove"]),
        ]);
        if (mode !== "restore-error") expect(configBytes).toEqual(original);
        expect(decodeConfigCbor(configBytes).ok).toBe(true);
        await expect(
          withExclusiveRecipeHardwareTest(client, async () => "released"),
        ).resolves.toBe("released");
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
