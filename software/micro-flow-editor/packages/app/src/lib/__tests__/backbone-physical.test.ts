import { describe, expect, it } from "vitest";
import {
  PHYSICAL_CATALOG,
  addPortInterface,
  allocatableInterfaceKinds,
  assignModeToPin,
  availablePeripheralKinds,
  availablePinsForSignal,
  catalogEntry,
  derivePortInterfaces,
  draftModesForBinding,
  dropSignalOnPin,
  draftForBinding,
  ensureW1Config,
  expectedFunctionTag,
  functionPinGrid,
  busUnitLabel,
  ESP32_S3_BUS_UNITS,
  functionPinHardware,
  kindForMode,
  modesForVariant,
  modesProvideBus,
  numberedPeripheralName,
  physicalLabelForSignalMode,
  silkPinLabels,
  parsePhysicalCatalog,
  pinVisualKind,
  signalModeIsPlaced,
  pinsForModes,
  removePortInterface,
  STATUS_LED_GPIO,
  tagForSlot,
  topologyForBoard,
  reportedFunctionVariant,
  validatePhysicalModes,
} from "../backbone-physical.js";
import type { GetStatusResponse, NfcTagStatus } from "@spaghettilab/protocol-sdk";

const tag: NfcTagStatus = {
  portId: 2,
  typeId: "sensor",
  uid: new Uint8Array([1, 2, 3, 4]),
  nodeId: 42,
  local: false,
  registryId: 1,
  vendorId: 1,
  moduleTypeId: 2001,
};
const status: GetStatusResponse = {
  state: 0,
  mode: 0,
  imageState: 0,
  activeSlot: 0,
  imageConfirmed: true,
  version: "v1",
  portCount: 2,
  lastResetCause: 0,
  healthState: 0,
  modules: [],
  physical: new Uint8Array([1, 1, 2, 1, 0, 25, 0, 0, 0, 0, 0, 0, 0]),
  nfcTags: [tag],
  chainPeers: [
    {
      nodeId: 42,
      mac: new Uint8Array(6),
      flags: 0,
      local: false,
      physical: new Uint8Array([1, 1, 2, 1, 0, 25, 0, 4, 5, 0, 0, 1, 2]),
    },
  ],
};

/** Full MCU caps: I2C|SPI|UART|DI|DO|ADC|W1|PWM. */
const FULL_CAPS = 1 | 2 | 4 | 16 | 32 | 64 | 128;

describe("physical composition", () => {
  it("matches the complete NFC authority identity, never fallback labels", () => {
    expect(PHYSICAL_CATALOG).toHaveLength(2);
    expect(catalogEntry(tag, PHYSICAL_CATALOG)?.name).toBe("Sensor Demo Module");
    expect(catalogEntry({ ...tag, vendorId: 2 }, PHYSICAL_CATALOG)).toBeUndefined();
    expect(catalogEntry({ ...tag, registryId: undefined }, PHYSICAL_CATALOG)).toBeUndefined();
    expect(catalogEntry(tag, PHYSICAL_CATALOG)?.pins).toBeUndefined();
  });
  it("separates peers that use the same port numbers", () => {
    expect(topologyForBoard(status, { nodeId: 42, local: false })?.modes).toEqual([4, 5, 0, 0]);
    expect(topologyForBoard(status, { nodeId: 0, local: true })?.modes).toEqual([0, 0, 0, 0]);
    expect(topologyForBoard(status, { nodeId: 43, local: false })).toBeUndefined();
    expect(tagForSlot(status, { nodeId: 0, local: true }, 2)).toBeUndefined();
    expect(tagForSlot(status, { nodeId: 42, local: false }, 2)).toEqual(tag);
  });
  it("keeps power pins fixed and validates the real I2C pair", () => {
    expect(pinsForModes([4, 5, 0, 1], "v1")).toEqual(["5V", "SDA", "SCL", "NC", "GPIO IN", "GND"]);
    expect(pinsForModes([6, 7, 0, 0], "v1")).toEqual(["5V", "TX", "RX", "NC", "NC", "GND"]);
    expect(pinsForModes([8, 9, 10, 11], "v1")).toEqual(["5V", "SCK", "MOSI", "MISO", "CS", "GND"]);
    expect(pinsForModes([1, 2, 17, 0], "v1")).toEqual([
      "5V",
      "GPIO IN",
      "GPIO OUT",
      "GPIO IN PULLUP",
      "NC",
      "GND",
    ]);
    expect(validatePhysicalModes([4, 0, 0, 0], 0)).toBeDefined();
    expect(validatePhysicalModes([0, 0, 4, 5], 0)).toBeUndefined();
    expect(validatePhysicalModes([7, 0, 6, 12], 0)).toBeUndefined();
    expect(validatePhysicalModes([8, 10, 11, 9], 0)).toBeUndefined();
    expect(validatePhysicalModes([6, 6, 7, 0], 0)).toBeDefined();
    expect(validatePhysicalModes([4, 5, 17, 33], 1)).toBeUndefined();
  });
  it("maps V2 12-pin Module Function grid A0–A7", () => {
    const modes = [2, 0, 0, 0, 4, 5, 0, 1];
    // Silkscreen order: A4 A5 A6 A7 GND 3.3V / A3 A2 A1 A0 GND 5V
    expect(pinsForModes(modes, "v2")).toEqual([
      "SDA",
      "SCL",
      "NC",
      "GPIO IN",
      "GND",
      "3.3V",
      "NC",
      "NC",
      "NC",
      "GPIO OUT",
      "GND",
      "5V",
    ]);
    const grid = functionPinGrid(modes, "v2");
    expect(grid).toHaveLength(2);
    expect(grid[0]!.map((c) => c.label)).toEqual(["SDA", "SCL", "NC", "GPIO IN", "GND", "3.3V"]);
    expect(grid[1]!.map((c) => c.label)).toEqual(["NC", "NC", "NC", "GPIO OUT", "GND", "5V"]);
    expect(modesForVariant([4, 5, 0, 0], "v2")).toEqual([4, 5, 0, 0, 0, 0, 0, 0]);
    expect(modesForVariant([1, 2, 3, 0, 4, 5, 6, 7], "v1")).toEqual([1, 2, 3, 0]);
    expect(validatePhysicalModes([0, 0, 0, 0, 0, 0, 0, 0], 0)).toBeUndefined();
    expect(pinVisualKind("3.3V")).toBe("power");
    expect(kindForMode(0)).toBeNull();
    expect(kindForMode(2)).toBe("gpio");
    expect(kindForMode(4)).toBe("i2c");
    expect(kindForMode(14)).toBe("adc");
    expect(grid[1]![3]!.mode).toBe(2); // A0
    expect(grid[0]![0]!.modeIndex).toBe(4); // A4
  });
  it("offers ADC and overwrites a whole peripheral on drop", () => {
    expect(availablePeripheralKinds(0, true)).toContain("adc");
    expect(validatePhysicalModes([14, 0, 0, 0], 0)).toBeUndefined();
    let modes = [4, 5, 0, 0];
    modes = dropSignalOnPin(modes, 14, 2, "v1");
    expect(modes).toEqual([14, 0, 0, 0]);
    expect(derivePortInterfaces(modes, "v1").map((i) => i.kind)).toEqual(["adc"]);
  });
  it("lets GPIO and ADC occupy many pins while bus signals stay unique", () => {
    let modes = [0, 0, 0, 0, 0, 0, 0, 0];
    modes = dropSignalOnPin(modes, 14, 0, "v2");
    modes = dropSignalOnPin(modes, 14, 1, "v2");
    modes = dropSignalOnPin(modes, 2, 2, "v2");
    modes = dropSignalOnPin(modes, 2, 3, "v2");
    expect(modes.slice(0, 4)).toEqual([14, 14, 2, 2]);
    expect(derivePortInterfaces(modes, "v2").filter((i) => i.kind === "adc")).toHaveLength(2);
    expect(derivePortInterfaces(modes, "v2").filter((i) => i.kind === "gpio")).toHaveLength(2);
    expect(validatePhysicalModes(modes, 0)).toBeUndefined();
    // Bus signals stay unique and do not move when dropped again.
    modes = dropSignalOnPin(modes, 4, 4, "v2");
    modes = dropSignalOnPin(modes, 4, 5, "v2");
    expect(modes[4]).toBe(4);
    expect(modes[5]).toBe(0);
    expect(signalModeIsPlaced(modes, 4)).toBe(true);
  });
  it("maps Function A0–A7 to connector IO7–IO15 from the silkscreen", () => {
    expect(functionPinHardware(0, "v2")).toMatchObject({ gpio: 7, connectorPin: 11 });
    expect(functionPinHardware(3, "v2")).toMatchObject({ gpio: 10, connectorPin: 14 });
    expect(functionPinHardware(4, "v2")).toMatchObject({ gpio: 12, connectorPin: 16 });
    expect(functionPinHardware(7, "v2")).toMatchObject({ gpio: 15, connectorPin: 19 });
  });
  it("exposes numbered ESP32-S3 bus units and placed-signal checks", () => {
    expect(ESP32_S3_BUS_UNITS.i2c).toEqual([0, 1]);
    expect(ESP32_S3_BUS_UNITS.spi).toEqual([2, 3]);
    expect(busUnitLabel("i2c", 0)).toBe("I2C0");
    expect(busUnitLabel("spi", 2)).toBe("SPI2");
    expect(signalModeIsPlaced([4, 5, 0, 0], 4)).toBe(true);
    expect(signalModeIsPlaced([4, 5, 0, 0], 6)).toBe(false);
  });
  it("encodes the NFC snapshot with exact byte order and UID", () => {
    expect([...expectedFunctionTag(tag, true)]).toEqual([
      0, 1, 0, 1, 0, 0, 7, 209, 4, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 1,
    ]);
    expect([...expectedFunctionTag(undefined)]).toEqual(Array(20).fill(0));
  });
  it("supports multiple interfaces on one port without wiping free pins", () => {
    let modes = [0, 0, 0, 0];
    modes = addPortInterface(modes, "i2c");
    expect(modes).toEqual([4, 5, 0, 0]);
    expect(pinsForModes(modes)).toEqual(["5V", "SDA", "SCL", "NC", "NC", "GND"]);
    expect(allocatableInterfaceKinds(modes, FULL_CAPS, true)).toEqual([
      "gpio",
      "adc",
      "pwm",
      "w1",
      "uart",
    ]);
    expect(allocatableInterfaceKinds(modes, FULL_CAPS, true)).not.toContain("spi");
    expect(allocatableInterfaceKinds(modes, FULL_CAPS, true)).not.toContain("i2c");

    modes = addPortInterface(modes, "w1");
    expect(modes).toEqual([4, 5, 13, 0]);
    expect(pinsForModes(modes)).toEqual(["5V", "SDA", "SCL", "DQ", "NC", "GND"]);
    modes = addPortInterface(modes, "gpio");
    expect(pinsForModes(modes)).toEqual(["5V", "SDA", "SCL", "DQ", "GPIO OUT", "GND"]);
    expect(validatePhysicalModes(modes, 0)).toBeUndefined();
    expect(derivePortInterfaces(modes).map((item) => item.kind)).toEqual([
      "i2c",
      "w1",
      "gpio",
    ]);
    expect(numberedPeripheralName("w1", 1)).toBe("1-Wire 0");
    const withW1 = ensureW1Config({
      name: "Function",
      modes,
      i2cSpeed: 0,
    });
    expect(withW1.w1Config?.name).toBe("1-Wire 0");
    expect(withW1.w1Config?.externalPullupRequired).toBe(true);
    expect(withW1.w1Config?.parasiticSupported).toBe(false);

    modes = [4, 5, 0, 0];
    modes = addPortInterface(modes, "uart");
    expect(modes).toEqual([4, 5, 6, 7]);
    expect(pinsForModes(modes)).toEqual(["5V", "SDA", "SCL", "TX", "RX", "GND"]);
    expect(allocatableInterfaceKinds(modes, FULL_CAPS, true)).toEqual([]);

    modes = removePortInterface(modes, derivePortInterfaces(modes).find((i) => i.kind === "i2c")!);
    expect(modes).toEqual([0, 0, 6, 7]);
    expect(pinsForModes(modes)).toEqual(["5V", "NC", "NC", "TX", "RX", "GND"]);
  });
  it("moves bus signals across configurable pins without touching 5V/GND", () => {
    expect(assignModeToPin([4, 5, 0, 0], 2, 4)).toEqual([0, 5, 4, 0]);
    expect(availablePinsForSignal([4, 5, 0, 0], 4)).toEqual([2, 4, 5]);
    expect(pinVisualKind("5V")).toBe("power");
    expect(pinVisualKind("GND")).toBe("ground");
    expect(pinVisualKind("NC")).toBe("unused");
    expect(pinVisualKind("SDA")).toBe("signal");
  });
  it("imports complete definitions and rejects inconsistent electrical metadata", () => {
    const entry = {
      registryId: 1,
      vendorId: 1,
      moduleTypeId: 2001,
      name: "Custom",
      pins: pinsForModes([4, 5, 0, 0]),
      modes: [4, 5, 0, 0],
      i2cSpeed: 0,
    };
    expect(parsePhysicalCatalog(JSON.stringify([entry]))).toEqual([entry]);
    expect(() =>
      parsePhysicalCatalog(
        JSON.stringify([{ ...entry, pins: ["3V3", "SDA", "SCL", "NC", "NC", "GND"] }]),
      ),
    ).toThrow();
    expect(() => parsePhysicalCatalog(JSON.stringify([entry, entry]))).toThrow();
    expect(() =>
      parsePhysicalCatalog(JSON.stringify([{ ...entry, modes: [4, 0, 0, 0] }])),
    ).toThrow();
  });

  it("reports which buses Module Function modes already provide", () => {
    expect(modesProvideBus(undefined, "i2c")).toBe(false);
    expect(modesProvideBus([], "i2c")).toBe(false);
    expect(modesProvideBus([4, 5, 0, 0], "i2c")).toBe(true);
    expect(modesProvideBus([4, 5, 0, 0], "spi")).toBe(false);
    expect(modesProvideBus([8, 9, 10, 11], "spi")).toBe(true);
    expect(modesProvideBus([14, 0, 0, 0], "adc")).toBe(true);
    expect(modesProvideBus([0, 0, 0, 0], "gpio")).toBe(true);
    expect(STATUS_LED_GPIO).toBe(10);
  });

  it("reads the first draft modes for a core binding", () => {
    const project = {
      drafts: {
        "bind-a:deadbeef": {
          name: "Backbone",
          modes: [4, 5, 0, 0],
          i2cSpeed: 0,
        },
      },
      catalog: [],
    };
    expect(draftModesForBinding(project, "bind-a")).toEqual([4, 5, 0, 0]);
    expect(draftForBinding(project, "bind-a")?.name).toBe("Backbone");
    expect(draftModesForBinding({ drafts: {}, catalog: [] }, "missing")).toBeUndefined();
    expect(silkPinLabels("v2")).toEqual(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]);
    expect(physicalLabelForSignalMode([4, 5, 0, 0], 4, "v1")).toBe("Pin 2 · SDA");
  });
});

 describe("reported connector layout", () => {
  it("uses the V2 layout even though the protocol carries only four modes", () => {
    const topology = { layout: 2, modes: [13, 0, 0, 0] } as import("@spaghettilab/protocol-sdk").PhysicalBackbone;
    const variant = reportedFunctionVariant(topology)!;
    expect(variant).toBe("v2");
    expect(functionPinGrid(modesForVariant(topology.modes, variant), variant).flat()).toHaveLength(12);
    expect(reportedFunctionVariant({ ...topology, layout: 1 })).toBe("v1");
    expect(reportedFunctionVariant(undefined)).toBeUndefined();
  });
});
