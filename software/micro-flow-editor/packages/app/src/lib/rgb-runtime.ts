import {
  PortCapability,
  PortTransport,
  validateDeviceProfile,
  type DeviceProfileDraft,
  type Instruction,
} from "@spaghettilab/device-profile-authoring-model";
import type { DeviceRecipeDraft } from "./device-recipe-draft.js";
import {
  RGB_COLOR_FIELD,
  RGB_STATE_FIELD,
  rgbColor,
  validateRgbModule,
  type RgbStep,
} from "./rgb-module.js";
import type { RuntimeDriver } from "./driver-runtime-profile.js";
import { stableDriverHash } from "./driver-runtime-profile.js";

export function rgbInputCommand(
  draft: DeviceRecipeDraft,
  inputId: string,
): { commandId: number; argument?: number; mode: number } {
  const config = draft.rgbModule!;
  const input = config.inputs.find((item) => item.id === inputId);
  if (!input) throw new Error("Ingresso RGB non disponibile.");
  if (input.mode === "trigger")
    return {
      commandId: config.actions.findIndex((action) => action.id === input.actionId) + 1,
      mode: input.edge === "falling" ? 2 : 1,
    };
  return {
    commandId:
      config.actions.length +
      config.inputs
        .filter((item) => item.mode === "variable")
        .findIndex((item) => item.id === input.id) +
      1,
    argument: 1,
    mode: 5,
  };
}
export function compileRgbRuntime(
  draft: DeviceRecipeDraft,
  channels: ReadonlyMap<string, number>,
): RuntimeDriver {
  const config = draft.rgbModule!;
  validateRgbModule(config);
  const pins = ["RED", "GREEN", "BLUE"].map((id) => channels.get(id));
  if (
    pins.some((pin) => pin === undefined || pin < 0 || pin > 3) ||
    new Set(pins).size !== 3
  )
    throw new Error("Assegna tre uscite PWM distinte a R, G e B.");
  const packed = pins.reduce<number>((bits, pin, i) => bits | (pin! << (2 * i)), 0);
  const messageData: number[] = [];
  const row = (kind: number, index: number, value = 0) => [
    kind,
    index,
    value & 255,
    (value >>> 8) & 255,
    (value >>> 16) & 255,
    (value >>> 24) & 255,
  ];
  const variableIndex = (id: string) => {
    const index = config.variables.findIndex((variable) => variable.id === id);
    if (index < 0) throw new Error("Variabile RGB non disponibile.");
    return index;
  };
  const steps = (items: readonly RgbStep[]) =>
    items.flatMap((step) => {
      if (step.kind !== "color") return row(step.kind === "on" ? 1 : 0, 0);
      return step.variableId
        ? row(3, variableIndex(step.variableId))
        : row(2, 0, rgbColor(step.color));
    });
  const program = (bytes: number[]): Instruction => {
    if (!bytes.length || bytes.length > 96)
      throw new Error("L’azione RGB supera il limite di passi.");
    const offset = messageData.length;
    messageData.push(...bytes);
    return {
      op: "RGB_PROGRAM",
      offset,
      length: bytes.length,
      channels: packed,
      inverted: config.common === "anode",
    };
  };
  const initOps = [
    program([
      ...config.variables.flatMap((variable, index) =>
        row(5, index, rgbColor(variable.color)),
      ),
      ...row(2, 0, rgbColor(config.initialColor)),
      ...(config.initialOn ? [] : row(0, 0)),
    ]),
  ];
  const sampleOps: Instruction[] = [];
  const actions: { id: number; first: number; count: number }[] = [];
  config.actions.forEach((action, index) => {
    const first = sampleOps.length;
    sampleOps.push(program(steps(action.steps)), { op: "EMIT_RECORD" });
    actions.push({ id: index + 1, first, count: sampleOps.length - first });
  });
  config.inputs
    .filter((input) => input.mode === "variable")
    .forEach((input, index) => {
      if (input.mode !== "variable") return;
      const first = sampleOps.length;
      const action = config.actions.find((action) => action.id === input.actionId)!;
      sampleOps.push(
        {
          op: "LOAD_ARGUMENT",
          dst: 0,
          argumentId: 1,
          length: 4,
          littleEndian: true,
          required: true,
          low: 0,
          high: 0,
        },
        program([
          ...row(4, variableIndex(input.variableId), 0),
          ...steps(action.steps),
        ]),
        { op: "EMIT_RECORD" },
      );
      actions.push({
        id: config.actions.length + index + 1,
        first,
        count: sampleOps.length - first,
      });
    });
  if (sampleOps.length > 16)
    throw new Error(
      "Il Core consente 16 istruzioni per driver: riduci azioni o ingressi variabile.",
    );
  const profile: DeviceProfileDraft = {
    profileId: `rgb.${stableDriverHash(JSON.stringify(config) + packed)}`,
    version: 1,
    transport: PortTransport.GPIO,
    requiredCapabilities: PortCapability.PWM,
    maxTotalTimeMs: 1,
    maxTransactions: 64,
    maxBytes: 4096,
    messageData,
    initOps,
    sampleOps,
    safeStopOps: [],
    actions,
    sampleSchemaId: "rgb.state",
    sampleSchemaVersion: 1,
    sampleFields: [
      { fieldId: RGB_STATE_FIELD, type: "uint64", name: "rgb_on" },
      { fieldId: RGB_COLOR_FIELD, type: "uint64", name: "rgb_color" },
    ],
  };
  const result = validateDeviceProfile(profile);
  if (!result.ok)
    throw new Error(result.error.map((error) => error.remediation).join("; "));
  return {
    profile,
    actions: new Map(
      draft.commands.map((command) => [
        command.id,
        {
          commandId:
            config.actions.findIndex((action) => action.id === command.name) + 1,
          inputIds: {},
          outputIds: { state: RGB_STATE_FIELD, color: RGB_COLOR_FIELD },
        },
      ]),
    ),
  };
}
