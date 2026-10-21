import {
  PortCapability,
  type Instruction,
} from "@spaghettilab/device-profile-authoring-model";
import { createModuleProgramDraft } from "./new-module-program.js";
import { createNamedAction, type DeviceRecipeDraft } from "./device-recipe-draft.js";

/** A complete LED built entirely from the shared instruction set. */
export function catalogPwmLedModule(): DeviceRecipeDraft {
  const base = createModuleProgramDraft("gpio");
  const on = createNamedAction({ id: "pwm-on", name: "on", label: "Accendi" });
  const off = createNamedAction({ id: "pwm-off", name: "off", label: "Spegni" });
  const set = createNamedAction({
    id: "pwm-level",
    name: "level",
    label: "Imposta intensità",
  });
  const constant = (dst: number, low: number): Instruction => ({
    op: "LOAD_CONST",
    dst,
    length: 8,
    low,
    high: 0,
  });
  const pwm = (src: number): Instruction => ({
    op: "PWM_SET",
    src,
    channel: 0,
    frequencyHz: 0,
  });
  const emit = (src: number): Instruction => ({
    op: "EMIT_FIELD",
    src,
    fieldId: 1,
    width: 8,
    byteOrder: "le",
    signExtend: false,
    multiplier: 0,
  });
  const record: Instruction = { op: "EMIT_RECORD" };
  const steps: readonly (readonly Instruction[])[] = [
    [constant(0, 10000), pwm(0), constant(1, 100), emit(1), record],
    [constant(0, 0), pwm(0), emit(0), record],
    [
      {
        op: "LOAD_ARGUMENT",
        dst: 0,
        argumentId: 1,
        length: 8,
        littleEndian: true,
        required: false,
        low: 100,
        high: 0,
      },
      {
        op: "SCALE_PACK",
        src: 0,
        dst: 1,
        flags: 0,
        width: 8,
        divisor: 1,
        multiplier: 100,
        offset: 0,
      },
      pwm(1),
      emit(0),
      record,
    ],
  ];
  let offset = 0;
  const actions = steps.map((list, index) => {
    const action = { id: index + 1, first: offset, count: list.length };
    offset += list.length;
    return action;
  });
  return {
    ...base,
    id: "gpio-pwm-led",
    name: "LED PWM",
    status: "ready",
    updatedAt: Date.UTC(2026, 9, 21),
    description:
      "Un’uscita PWM: accendi, spegni e imposta intensità. Ogni azione è composta da passi comuni modificabili.",
    deviceCategory: "output",
    gpioHardware: { kind: "led", ground: true, power: "none", extraTerminals: [] },
    binding: {
      ...base.binding,
      gpioSignals: base.binding.gpioSignals.map((signal) => ({
        ...signal,
        signalType: "pwm_output",
        requirements: { writable: true, pwm: true },
      })),
    },
    commands: [on, off, set],
    channels: [
      {
        id: "intensity",
        label: "Intensità attuale",
        unit: "%",
        quantity: "analog",
        direction: "read",
        dataType: "int",
      },
      {
        id: "level",
        label: "Intensità",
        unit: "%",
        quantity: "analog",
        direction: "write",
        dataType: "int",
      },
    ],
    moduleProgram: {
      ...base.moduleProgram!,
      actions: {
        [on.id]: { commandId: 1, inputIds: {}, outputIds: { intensity: 1 } },
        [off.id]: { commandId: 2, inputIds: {}, outputIds: { intensity: 1 } },
        [set.id]: { commandId: 3, inputIds: { level: 1 }, outputIds: { intensity: 1 } },
      },
      profile: {
        ...base.moduleProgram!.profile,
        requiredCapabilities: PortCapability.PWM,
        initOps: [constant(0, 0), pwm(0)],
        safeStopOps: [constant(0, 0), pwm(0)],
        sampleOps: steps.flat(),
        actions,
        sampleSchemaId: "pwm.intensity",
        sampleFields: [{ fieldId: 1, type: "uint64", name: "intensity", unit: "%" }],
      },
    },
  };
}
