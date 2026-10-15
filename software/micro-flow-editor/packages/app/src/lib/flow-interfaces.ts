import {
  defaultOp,
  nextRecipeVariableName,
  updateOpAnywhere,
  upsertRecipeVariable,
  ensureWriteChannel,
  type DeviceRecipeDraft,
  type DeviceRecipeOp,
} from "./device-recipe-draft.js";
export type FlowInterfaceKind = "sample_external" | "encode" | "decode" | "emit";
export function addFlowInterface(
  draft: DeviceRecipeDraft,
  type: FlowInterfaceKind,
  actionId?: string | null,
): { draft: DeviceRecipeDraft; op: DeviceRecipeOp } {
  let base = draft,
    op = defaultOp(type, draft);
  const interfaces = [...(draft.flowInterfaces ?? [])];
  if (op.type === "sample_external") {
    let index = 1;
    while (
      draft.channels.some((c) => c.id === `ingresso_${index}`) ||
      draft.variables.some((v) => v.name === `ingresso_${index}`)
    )
      index++;
    const name = `ingresso_${index}`;
    const ensured = ensureWriteChannel(base, { id: name, label: `Ingresso ${index}` });
    base = ensured.draft;
    op = {
      ...op,
      fromChannelId: name,
      into: nextRecipeVariableName(base),
      valueType: "number",
      widthBytes: 1,
      byteOrder: "be",
    };
  }
  if (op.type === "encode" || op.type === "decode") {
    let into = op.into,
      index = 2;
    while (draft.variables.some((v) => v.name === into)) into = `${op.into}_${index++}`;
    if (op.type === "encode") {
      const source = [...interfaces]
        .reverse()
        .find((item) => item.type === "sample_external");
      op = {
        ...op,
        into,
        ...(source?.type === "sample_external"
          ? { input: source.into, fromType: source.valueType }
          : {}),
      };
    } else {
      const body =
        draft.commands.find((command) => command.id === actionId)?.steps ?? [];
      const read = [...body]
        .reverse()
        .find((item) => item.type === "i2c_read" || item.type === "i2c_write_read");
      op = {
        ...op,
        into,
        ...(read?.type === "i2c_read" || read?.type === "i2c_write_read"
          ? {
              input: read.into,
              endByte: (read.type === "i2c_read" ? read.len : read.readLen) - 1,
            }
          : {}),
      };
    }
  }
  if (op.type === "sample_external" || op.type === "encode" || op.type === "decode")
    base = upsertRecipeVariable(base, {
      name: op.into,
      valueType:
        op.type === "encode"
          ? op.toType
          : op.type === "decode"
            ? (op.outType ?? "number")
            : op.valueType,
    });
  if (op.type === "emit") {
    let index = 1;
    while (base.channels.some((c) => c.id === `uscita_${index}`)) index++;
    const decoded = [...interfaces].reverse().find((item) => item.type === "decode");
    const read = [
      ...(draft.commands.find((command) => command.id === actionId)?.steps ?? []),
    ]
      .reverse()
      .find((step) => step.type === "i2c_read" || step.type === "i2c_write_read");
    const from =
      decoded?.type === "decode"
        ? decoded.into
        : read && "into" in read
          ? read.into
          : (draft.variables[0]?.name ?? "");
    const id = `uscita_${index}`;
    base = {
      ...base,
      channels: [
        ...base.channels,
        { id, label: from, direction: "read", quantity: "other", unit: "" },
      ],
    };
    op = { ...op, channelId: id, from };
  }
  base = { ...base, flowInterfaces: [...interfaces, op], updatedAt: Date.now() };
  return { draft: base, op };
}
/** Encoder input acquisition is itself an interface, not an I²C action step. */
export function bindFlowEncoderInput(
  draft: DeviceRecipeDraft,
  encoderId: string,
  channelId?: string,
): DeviceRecipeDraft {
  const encoder = draft.flowInterfaces?.find(
    (op) => op.id === encoderId && op.type === "encode",
  );
  if (!encoder || encoder.type !== "encode") return draft;
  let base = draft;
  let source = base.flowInterfaces?.find(
    (op) => op.type === "sample_external" && op.fromChannelId === channelId,
  );
  if (!source) {
    const added = addFlowInterface(base, "sample_external");
    base = added.draft;
    source = added.op;
    if (channelId && source.type === "sample_external") {
      source = { ...source, fromChannelId: channelId };
      base = updateOpAnywhere(base, source.id, source);
    }
  }
  if (source.type !== "sample_external") return draft;
  const withoutEncoder = base.flowInterfaces!.filter((op) => op.id !== encoderId);
  const index = withoutEncoder.findIndex((op) => op.id === source!.id);
  withoutEncoder.splice(index + 1, 0, {
    ...encoder,
    input: source.into,
    fromType: source.valueType,
  });
  return { ...base, flowInterfaces: withoutEncoder, updatedAt: Date.now() };
}
