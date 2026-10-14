import {
  addCommand,
  createNamedAction,
  normalizeRecipeVarName,
  type DeviceRecipeCommand,
  type DeviceRecipeDraft,
  type DeviceRecipeOp,
} from "./device-recipe-draft.js";

export type RegisterActionKind = "read" | "write";
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** High-level register steps keep the existing, executable I²C representation. */
export function registerStep(kind: RegisterActionKind, into = "raw"): DeviceRecipeOp {
  return kind === "read"
    ? {
        id: id("step"),
        type: "i2c_write_read",
        writeBytes: ["00"],
        readLen: 1,
        into,
        registerWidth: 1,
      }
    : { id: id("step"), type: "i2c_write", bytes: ["00", "00"], registerWidth: 1 };
}

export function addRegisterAction(
  draft: DeviceRecipeDraft,
  kind: RegisterActionKind,
  it: boolean,
): DeviceRecipeDraft {
  const base =
    draft.commands.length === 1 && draft.commands[0]!.steps.length === 0
      ? { ...draft, commands: [] }
      : draft;
  let ordinal = base.commands.length + 1;
  while (
    base.channels.some((c) => c.id === `valore_${ordinal}`) ||
    base.commands.some(
      (c) =>
        c.name === `leggi_registro_${ordinal}` ||
        c.name === `scrivi_registro_${ordinal}`,
    )
  )
    ordinal += 1;
  const name = `${kind === "read" ? "leggi" : "scrivi"}_registro_${ordinal}`;
  const label = it
    ? `${kind === "read" ? "Leggi" : "Scrivi"} registro ${ordinal}`
    : `${kind === "read" ? "Read" : "Write"} register ${ordinal}`;
  const raw = `raw_${ordinal}`;
  const value = `valore_${ordinal}`;
  const channelId = normalizeRecipeVarName(value);
  const steps: DeviceRecipeOp[] = [registerStep(kind, raw)];
  if (kind === "read") {
    steps.push({
      id: id("decode"),
      type: "decode",
      input: raw,
      into: value,
      byteOrder: "be",
      signed: false,
      startByte: 0,
      endByte: 0,
      outType: "number",
    });
    steps.push({ id: id("emit"), type: "emit", channelId, from: value });
  }
  const next = addCommand(base, { name, label, steps });
  return kind === "read"
    ? {
        ...next,
        channels: [
          ...draft.channels,
          {
            id: channelId,
            label: value,
            unit: "",
            quantity: "other",
            direction: "read",
          },
        ],
      }
    : next;
}

export function duplicateDriverAction(
  draft: DeviceRecipeDraft,
  action: DeviceRecipeCommand,
): DeviceRecipeDraft {
  let suffix = "copia";
  let index = 2;
  while (draft.commands.some((c) => c.name === `${action.name}_${suffix}`))
    suffix = `copia_${index++}`;
  const copy = createNamedAction({
    ...action,
    id: id("action"),
    name: `${action.name}_${suffix}`,
    label: `${action.label} (copia)`,
    steps: action.steps.map((op) => ({ ...op, id: id("step") })),
    params: action.params.map((p) => ({ ...p, id: id("param") })),
  });
  return { ...draft, commands: [...draft.commands, copy], updatedAt: Date.now() };
}

export function actionPorts(draft: DeviceRecipeDraft, action: DeviceRecipeCommand) {
  const outputs = new Set(
    action.steps.flatMap((op) => (op.type === "emit" ? [op.channelId] : [])),
  );
  const inputs = new Set(
    action.steps.flatMap((op) =>
      op.type === "sample_external" ? [op.fromChannelId] : [],
    ),
  );
  return {
    inputs: draft.channels.filter((c) => inputs.has(c.id)),
    outputs: draft.channels.filter((c) => outputs.has(c.id)),
  };
}
