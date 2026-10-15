import { describe, expect, it } from "vitest";
import {
  addCommand,
  createBlankDraft,
  recipeVariables,
  renameRecipeVariable,
  upsertRecipeVariable,
  serializeDeviceRecipeDraft,
  parseDeviceRecipeDraft,
  isVariableUsed,
  effectiveActionSteps,
  type DeviceRecipeDraft,
} from "../device-recipe-draft.js";
import { addFlowInterface } from "../flow-interfaces.js";
import { compileRuntimeDriver } from "../driver-runtime-profile.js";

describe("stable recipe variable renaming", () => {
  it("renames uses across all phases and interfaces without changing port or action identities", () => {
    const base = upsertRecipeVariable(createBlankDraft("i2c"), {
      name: "var1",
      valueType: "hex",
    });
    const id = base.variables[0]!.id;
    const draft: DeviceRecipeDraft = {
      ...base,
      phases: {
        init: [{ id: "init", type: "i2c_write", bytes: ["00", "$var1", "$var10"] }],
        sample: [
          {
            id: "sample",
            type: "i2c_write_read",
            writeBytes: ["$var1"],
            readLen: 1,
            into: "var1",
          },
        ],
        command: [
          {
            id: "legacy",
            type: "i2c_transaction",
            into: "var1",
            phases: [
              { kind: "write", bytes: ["$var1"] },
              { kind: "read", len: 1 },
            ],
          },
        ],
      },
      commands: [
        {
          id: "action",
          name: "var1",
          label: "var1",
          description: "",
          params: [],
          steps: [
            {
              id: "decode",
              type: "decode",
              input: "var1",
              into: "decoded",
              byteOrder: "be",
              signed: false,
              startByte: 0,
              endByte: 0,
            },
            {
              id: "encode",
              type: "encode",
              input: "$var1",
              into: "encoded",
              fromType: "number",
              toType: "hex",
              byteOrder: "be",
              widthBytes: 1,
            },
            {
              id: "spi",
              type: "spi_transfer",
              txBytes: ["$var1"],
              rxLen: 1,
              into: "spi_rx",
              keepCs: false,
            },
            { id: "w1", type: "w1_write", bytes: ["$var1"] },
          ],
        },
      ],
      channels: [
        { id: "var1", label: "var1", direction: "write", quantity: "other", unit: "" },
      ],
      flowInterfaces: [
        {
          id: "input",
          type: "sample_external",
          fromChannelId: "var1",
          into: "var1",
          valueType: "hex",
        },
        { id: "output", type: "emit", channelId: "var1", from: "var1" },
      ],
    };
    const renamed = renameRecipeVariable(draft, id, "comando");
    expect(renamed.variables[0]).toMatchObject({ id, name: "comando" });
    expect(renamed.phases.init[0]).toMatchObject({
      bytes: ["00", "$comando", "$var10"],
    });
    expect(renamed.phases.sample[0]).toMatchObject({
      writeBytes: ["$comando"],
      into: "comando",
    });
    expect(renamed.phases.command[0]).toMatchObject({
      into: "comando",
      phases: [
        { kind: "write", bytes: ["$comando"] },
        { kind: "read", len: 1 },
      ],
    });
    expect(renamed.commands[0]).toMatchObject({
      id: "action",
      name: "var1",
      label: "var1",
      steps: [
        { input: "comando", into: "decoded" },
        { input: "$comando", into: "encoded" },
        { txBytes: ["$comando"] },
        { bytes: ["$comando"] },
      ],
    });
    expect(renamed.flowInterfaces).toMatchObject([
      { id: "input", fromChannelId: "var1", into: "comando" },
      { id: "output", channelId: "var1", from: "comando" },
    ]);
    expect(renamed.channels[0]!.id).toBe("var1");
    expect(draft.variables[0]!.name).toBe("var1");
    const restored = parseDeviceRecipeDraft(serializeDeviceRecipeDraft(renamed))!;
    expect(restored.variables[0]).toMatchObject({ id, name: "comando" });
    expect(restored.phases.init[0]).toMatchObject({
      bytes: ["00", "$comando", "$var10"],
    });
  });
  it("lists legacy read buffers and preserves their stable identity when renamed", () => {
    const draft: DeviceRecipeDraft = {
      ...createBlankDraft("i2c"),
      phases: {
        init: [{ id: "read", type: "i2c_read", len: 2, into: "raw" }],
        sample: [],
        command: [],
      },
    };
    const variable = recipeVariables(draft)[0]!;
    expect(variable).toMatchObject({ name: "raw", valueType: "hex" });
    expect(isVariableUsed(draft, "raw")).toBe(true);
    const renamed = renameRecipeVariable(draft, variable.id, "risposta");
    expect(recipeVariables(renamed)).toHaveLength(1);
    expect(recipeVariables(renamed)[0]).toMatchObject({
      id: variable.id,
      name: "risposta",
    });
    expect(renamed.phases.init[0]).toMatchObject({ into: "risposta" });
  });
  it("rejects collisions and empty names without merging or changing variables", () => {
    let draft = upsertRecipeVariable(createBlankDraft("i2c"), {
      name: "var1",
      valueType: "number",
    });
    draft = upsertRecipeVariable(draft, { name: "var2", valueType: "hex" });
    const variable = draft.variables[0]!;
    expect(() => renameRecipeVariable(draft, variable.id, "var2")).toThrow(
      "esiste già",
    );
    expect(() => upsertRecipeVariable(draft, { ...variable, name: "var2" })).toThrow(
      "esiste già",
    );
    expect(() => renameRecipeVariable(draft, variable.id, "")).toThrow(
      "Inserisci un nome",
    );
    expect(draft.variables.map((item) => item.name)).toEqual(["var1", "var2"]);
    expect(new Set(draft.variables.map((item) => item.id)).size).toBe(2);
  });
  it("produces the same executable profile after renaming a connected input variable", () => {
    let draft = addCommand(createBlankDraft("i2c"), { label: "Scrivi" });
    const input = addFlowInterface(draft, "sample_external");
    draft = input.draft;
    if (input.op.type !== "sample_external") throw new Error("input");
    draft = {
      ...draft,
      commands: draft.commands.map((command) => ({
        ...command,
        steps: [
          {
            id: "write",
            type: "i2c_write",
            bytes: [
              "00",
              `$${input.op.type === "sample_external" ? input.op.into : ""}`,
            ],
          },
        ],
      })),
    };
    const compile = (source: DeviceRecipeDraft) =>
      compileRuntimeDriver(
        {
          ...source,
          flowInterfaces: [],
          commands: source.commands.map((command) => ({
            ...command,
            steps: effectiveActionSteps(source, command),
          })),
        },
        new Map([
          [
            source.commands[0]!.id,
            new Set([
              input.op.type === "sample_external" ? input.op.fromChannelId : "",
            ]),
          ],
        ]),
      );
    const before = compile(draft);
    const renamed = renameRecipeVariable(draft, draft.variables[0]!.id, "luminosita");
    const after = compile(renamed);
    expect(after.profile).toEqual(before.profile);
    expect(after.actions).toEqual(before.actions);
  });
});
