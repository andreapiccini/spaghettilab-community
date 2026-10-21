import {
  PortTransport,
  PortCapability,
} from "@spaghettilab/device-profile-authoring-model";
import {
  createBlankDraft,
  createNamedAction,
  type DeviceRecipeBus,
  type DeviceRecipeDraft,
} from "./device-recipe-draft.js";

/** Empty executable starting point. No device-specific driver is hidden behind it. */
export function createModuleProgramDraft(
  bus: DeviceRecipeBus = "i2c",
): DeviceRecipeDraft {
  const draft = createBlankDraft(bus, "Nuovo modulo");
  const command = createNamedAction({ name: "azione", label: "Azione 1" });
  const transport = {
    i2c: PortTransport.I2C,
    spi: PortTransport.SPI,
    uart: PortTransport.UART,
    gpio: PortTransport.GPIO,
    adc: PortTransport.ADC,
    w1: PortTransport.W1,
  }[bus];
  const caps = {
    i2c: PortCapability.I2C,
    spi: PortCapability.SPI,
    uart: PortCapability.UART,
    gpio: PortCapability.DIGITAL_OUTPUT,
    adc: PortCapability.ADC,
    w1: PortCapability.W1,
  }[bus];
  const signals =
    bus === "gpio"
      ? [
          {
            id: "OUTPUT",
            name: "Uscita",
            identifier: "OUTPUT",
            direction: "out" as const,
            signalType: "digital_output" as const,
            role: "generic" as const,
            pinLabel: "",
            pull: "none" as const,
            activeLow: false,
            requirements: { writable: true },
          },
        ]
      : [];
  return {
    ...draft,
    commands: [command],
    binding: { ...draft.binding, gpioSignals: signals },
    moduleProgram: {
      version: 1,
      signals: signals.map((signal) => signal.id),
      actions: { [command.id]: { commandId: 1, inputIds: {}, outputIds: {} } },
      profile: {
        profileId: "module.new",
        version: 1,
        transport,
        requiredCapabilities: caps,
        maxTotalTimeMs: 60000,
        maxTransactions: 64,
        maxBytes: 65535,
        initOps: [],
        sampleOps: [{ op: "EMIT_RECORD" }],
        safeStopOps: [],
        actions: [{ id: 1, first: 0, count: 1 }],
        sampleSchemaId: "module.values",
        sampleSchemaVersion: 1,
        sampleFields: [],
      },
    },
  };
}
