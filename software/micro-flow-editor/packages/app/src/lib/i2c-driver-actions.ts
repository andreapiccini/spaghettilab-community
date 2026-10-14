import {
  addCommand,
  createNamedAction,
  normalizeRecipeVarName,
  ensureWriteChannel,
  upsertRecipeVariable,
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

/** Bind an external port to an encoder through an ordered, reusable input step. */
export function bindEncoderFlowInput(
  draft: DeviceRecipeDraft,
  encoderId: string,
  channelId?: string,
): DeviceRecipeDraft {
  if (
    ![
      ...draft.phases.init,
      ...draft.phases.sample,
      ...draft.phases.command,
      ...draft.commands.flatMap((c) => c.steps),
    ].some((op) => op.id === encoderId && op.type === "encode")
  )
    return draft;
  let next = draft;
  if (!channelId) {
    let index = 1;
    while (draft.channels.some((c) => c.id === `ingresso_${index}`)) index++;
    const ensured = ensureWriteChannel(draft, {
      id: `ingresso_${index}`,
      label: `Ingresso ${index}`,
    });
    next = ensured.draft;
    channelId = ensured.channelId;
  }
  const channel = next.channels.find(
    (c) => c.id === channelId && c.direction === "write",
  );
  if (!channel) return draft;
  function connect(steps: readonly DeviceRecipeOp[]): readonly DeviceRecipeOp[] {
    const index = steps.findIndex((op) => op.id === encoderId && op.type === "encode");
    if (index < 0) return steps;
    const encoder = steps[index] as Extract<DeviceRecipeOp, { type: "encode" }>;
    const existing = steps
      .slice(0, index)
      .find((op) => op.type === "sample_external" && op.fromChannelId === channel!.id);
    const valueType =
      channel!.quantity === "digital" ? ("bool" as const) : ("number" as const);
    let rawName = `flow_${normalizeRecipeVarName(channel!.id)}`;
    if (!existing) {
      let suffix = 2;
      const base = rawName;
      while (next.variables.some((v) => v.name === rawName))
        rawName = `${base}_${suffix++}`;
    }
    const source =
      existing?.type === "sample_external"
        ? existing
        : {
            id: id("input"),
            type: "sample_external" as const,
            fromChannelId: channel!.id,
            into: rawName,
            valueType,
          };
    next = upsertRecipeVariable(next, {
      name: source.into,
      valueType: source.valueType,
      label: source.into,
    });
    const patched = { ...encoder, input: source.into, fromType: source.valueType };
    return [
      ...steps.slice(0, index),
      ...(existing ? [] : [source]),
      patched,
      ...steps.slice(index + 1),
    ];
  }
  const commands = next.commands.map((command) => ({
    ...command,
    steps: connect(command.steps),
  }));
  const phases = {
    init: connect(next.phases.init),
    sample: connect(next.phases.sample),
    command: connect(next.phases.command),
  };
  return { ...next, commands, phases, updatedAt: Date.now() };
}
