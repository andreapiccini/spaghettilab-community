import { rgbInputCommand } from "./rgb-runtime.js";
import { validateOneWireRom } from "./onewire.js";
import {
  PortTransport,
  PortCapability,
  validateDeviceProfile,
  type DeviceProfileDraft,
  type Instruction,
} from "@spaghettilab/device-profile-authoring-model";
import type { DeviceRecipeDraft } from "./device-recipe-draft.js";
import type { RuntimeAction, RuntimeDriver } from "./driver-runtime-profile.js";
import { stableDriverHash } from "./driver-runtime-profile.js";

/** Authoring-only executable recipe. Channel numbers refer to named signals,
 * never to a particular Backbone or its assigned pins. */
export type ModuleProgram = {
  readonly version: 1;
  readonly profile: DeviceProfileDraft;
  readonly actions: Readonly<Record<string, RuntimeAction>>;
  readonly signals: readonly string[];
  readonly rgbInputs?: Readonly<
    Record<string, { commandId: number; argument?: number; mode: number }>
  >;
};

export function instructionFitsModule(
  op: Instruction["op"],
  profile: DeviceProfileDraft,
): boolean {
  const family =
    op.startsWith("I2C_") || op === "WAIT_FIELD_MASK"
      ? PortTransport.I2C
      : op === "SPI_TRANSCEIVE"
        ? PortTransport.SPI
        : op.startsWith("UART_")
          ? PortTransport.UART
          : op === "W1_WRITE_READ"
            ? PortTransport.W1
            : undefined;
  if (family !== undefined && profile.transport !== family) return false;
  if (
    ["DHT22_POWER", "DHT22_READ", "DS18B20_SETUP", "DS18B20_READ"].includes(op) &&
    (profile.transport !== PortTransport.GPIO ||
      (profile.requiredCapabilities &
        (PortCapability.DIGITAL_INPUT | PortCapability.DIGITAL_OUTPUT)) !==
        (PortCapability.DIGITAL_INPUT | PortCapability.DIGITAL_OUTPUT))
  )
    return false;
  if (
    ["PWM_SET", "RGB_PROGRAM"].includes(op) &&
    profile.transport !== PortTransport.GPIO
  )
    return false;
  const capability =
    op === "GPIO_GET" || op === "WAIT_GPIO"
      ? PortCapability.DIGITAL_INPUT
      : ["GPIO_SET", "GPIO_SET_VALUE", "GPIO_PULSE", "STEPPER"].includes(op)
        ? PortCapability.DIGITAL_OUTPUT
        : ["RGB_PROGRAM", "PWM_SET"].includes(op)
          ? PortCapability.PWM
          : op === "ADC_READ"
            ? PortCapability.ADC
            : 0;
  return !capability || (profile.requiredCapabilities & capability) === capability;
}

export function programFromRuntime(
  draft: DeviceRecipeDraft,
  runtime: RuntimeDriver,
): ModuleProgram {
  return structuredClone({
    version: 1,
    profile: runtime.profile,
    actions: Object.fromEntries(runtime.actions),
    signals: draft.binding.gpioSignals.map((signal) => signal.id),
    ...(draft.rgbModule
      ? {
          rgbInputs: Object.fromEntries(
            draft.rgbModule.inputs.map((input) => [
              input.id,
              rgbInputCommand(
                {
                  ...draft,
                  rgbModule: {
                    ...draft.rgbModule!,
                    inputMode: input.mode === "component" ? "rgb" : "hex",
                  },
                },
                input.id,
              ),
            ]),
          ),
        }
      : {}),
  });
}
export function compileModuleProgram(
  draft: DeviceRecipeDraft,
  channels: ReadonlyMap<string, number>,
  connected: ReadonlyMap<string, ReadonlySet<string>>,
): RuntimeDriver {
  const program = draft.moduleProgram!;
  if (draft.binding.bus === "w1") {
    const checked = validateOneWireRom(draft.binding.w1?.rom ?? "");
    if (!checked.ok) throw new Error(checked.message);
  }
  if (program.version !== 1)
    throw new Error("Versione della ricetta eseguibile non supportata.");
  const channel = (index: number) => {
    const signal = program.signals[index];
    const assigned = signal === undefined ? undefined : channels.get(signal);
    if (
      assigned === undefined ||
      assigned < 0 ||
      assigned > 3 ||
      !Number.isInteger(assigned)
    )
      throw new Error(
        `Assegna il segnale ${signal ?? index} prima di caricare il modulo.`,
      );
    return assigned;
  };
  const remap = (op: Instruction): Instruction => {
    switch (op.op) {
      case "WAIT_GPIO":
        if (channel(0) !== 0)
          throw new Error(
            "Attendi ingresso richiede il primo segnale su A0; usa Leggi ingresso sugli altri pin.",
          );
        return { ...op };
      case "GPIO_GET":
      case "GPIO_SET":
        return { ...op, channel: channel(op.channel ?? 0) };
      case "PWM_SET":
      case "GPIO_SET_VALUE":
      case "GPIO_PULSE":
      case "DS18B20_READ":
        return { ...op, channel: channel(op.channel) };
      case "DS18B20_SETUP":
        return {
          ...op,
          channel: channel(op.channel),
          ...(op.powerChannel === undefined
            ? {}
            : { powerChannel: channel(op.powerChannel) }),
        };
      case "DHT22_POWER":
      case "DHT22_READ":
        return {
          ...op,
          dataChannel: channel(op.dataChannel),
          powerChannel: channel(op.powerChannel),
        };
      case "RGB_PROGRAM":
        return {
          ...op,
          channels: [0, 1, 2].reduce(
            (bits, index) =>
              bits | (channel((op.channels >> (index * 2)) & 3) << (index * 2)),
            0,
          ),
        };
      case "STEPPER":
        return {
          ...op,
          channels: [0, 1, 2, 3].reduce(
            (bits, index) =>
              bits | (channel((op.channels >> (index * 2)) & 3) << (index * 2)),
            0,
          ),
        };
      default:
        return { ...op };
    }
  };
  for (const op of [
    ...program.profile.initOps,
    ...program.profile.sampleOps,
    ...program.profile.safeStopOps,
  ]) {
    if (!instructionFitsModule(op.op, program.profile))
      throw new Error(
        `Il passo ${op.op} non è compatibile con la periferica dichiarata dal modulo.`,
      );
  }
  if (program.profile.initOps.some((op) => op.op === "LOAD_ARGUMENT"))
    throw new Error(
      "I parametri d’ingresso si leggono nelle azioni, non nell’inizializzazione.",
    );
  const profile = {
    ...structuredClone(program.profile),
    initOps: program.profile.initOps.map(remap),
    sampleOps: program.profile.sampleOps.map(remap),
    safeStopOps: program.profile.safeStopOps.map(remap),
  };
  let actions = new Map(Object.entries(program.actions));
  if (draft.commands.some((command) => command.programActionId)) {
    const sampleOps: Instruction[] = [];
    const slices: { id: number; first: number; count: number }[] = [];
    actions = new Map(
      draft.commands.map((command, index) => {
        const original = program.actions[command.programActionId ?? command.id];
        const slice = program.profile.actions?.find(
          (item) => item.id === original?.commandId,
        );
        if (!original || !slice)
          throw new Error(
            `L’azione ${command.label} non ha più una sequenza eseguibile.`,
          );
        const first = sampleOps.length;
        sampleOps.push(
          ...profile.sampleOps.slice(slice.first, slice.first + slice.count),
        );
        slices.push({ id: index + 1, first, count: slice.count });
        return [
          command.id,
          {
            ...original,
            commandId: index + 1,
            outputIds: Object.fromEntries(
              Object.entries(original.outputIds).map(([id, field]) => [
                `${command.id}/${id}`,
                field,
              ]),
            ),
          },
        ];
      }),
    );
    profile.sampleOps = sampleOps;
    profile.actions = slices;
  }
  // A connected action parameter must not silently fall back to the preview value.
  profile.sampleOps = profile.sampleOps.map((op, index) => {
    if (op.op !== "LOAD_ARGUMENT") return op;
    const slice = profile.actions?.find(
      (action) => index >= action.first && index < action.first + action.count,
    );
    const entry = [...actions].find(([, action]) => action.commandId === slice?.id);
    const input =
      entry &&
      Object.entries(entry[1].inputIds).find(([, id]) => id === op.argumentId)?.[0];
    return entry && input
      ? {
          ...op,
          required: op.required || (connected.get(entry[0])?.has(input) ?? false),
        }
      : op;
  });
  profile.profileId = `mod.${stableDriverHash(JSON.stringify(profile))}`;
  const checked = validateDeviceProfile(profile);
  if (!checked.ok)
    throw new Error(checked.error.map((issue) => issue.remediation).join("; "));
  return { profile, actions };
}

/** Keep the canvas contract in sync with the fields actually consumed/emitted. */
export function synchronizeModuleProgram(draft: DeviceRecipeDraft): DeviceRecipeDraft {
  const program = draft.moduleProgram;
  if (!program) return draft;
  const channels = [...draft.channels];
  const actions: Record<string, RuntimeAction> = {};
  for (const [id, entry] of Object.entries(program.actions)) {
    const slice = program.profile.actions?.find((item) => item.id === entry.commandId);
    if (!slice) throw new Error("L’azione non ha più una sequenza eseguibile.");
    const steps = program.profile.sampleOps.slice(
      slice.first,
      slice.first + slice.count,
    );
    const outputIds: Record<string, number> = {};
    for (const step of steps) {
      if (step.op !== "EMIT_FIELD" && step.op !== "EMIT_DECIMAL") continue;
      const field = program.profile.sampleFields.find(
        (item) => item.fieldId === step.fieldId,
      );
      if (!field)
        throw new Error(`Definisci l’uscita ${step.fieldId} prima di pubblicarla.`);
      const existing = Object.entries(entry.outputIds).find(
        ([, key]) => key === field.fieldId,
      )?.[0];
      const channelId = existing ?? `output_${field.fieldId}`;
      outputIds[channelId] = field.fieldId;
      if (!channels.some((item) => item.id === channelId))
        channels.push({
          id: channelId,
          label: field.name,
          unit: field.unit ?? "",
          quantity: "other",
          direction: "read",
          dataType: field.type === "text" ? "string" : "number",
        });
    }
    // RGB's atomic operation publishes its state internally.
    if (steps.some((step) => step.op === "RGB_PROGRAM"))
      Object.assign(outputIds, entry.outputIds);
    const inputIds = { ...entry.inputIds };
    for (const step of steps) {
      if (step.op !== "LOAD_ARGUMENT") continue;
      const existing = Object.entries(inputIds).find(
        ([, key]) => key === step.argumentId,
      )?.[0];
      const channelId = existing ?? `input_${step.argumentId}`;
      inputIds[channelId] = step.argumentId;
      if (!channels.some((item) => item.id === channelId))
        channels.push({
          id: channelId,
          label: `Parametro ${step.argumentId}`,
          unit: "",
          quantity: "other",
          direction: "write",
          dataType: "int",
        });
    }
    actions[id] = { ...entry, inputIds, outputIds };
  }
  return { ...draft, channels, moduleProgram: { ...program, actions } };
}
