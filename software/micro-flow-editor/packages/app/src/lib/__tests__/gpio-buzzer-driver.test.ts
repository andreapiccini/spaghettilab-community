import { expect, it } from "vitest";
import { catalogGpioBuzzerDriver } from "../gpio-driver-presets.js";
import { validateDraftForCreate } from "../device-recipe-draft.js";
import { compileRuntimeDriver } from "../driver-runtime-profile.js";
import { builtinNfcDrivers } from "../nfc-workspace.js";

it("provides a stable NFC driver with off initialization and a nonblocking beep", () => {
  const draft = catalogGpioBuzzerDriver();
  expect(draft).toEqual(catalogGpioBuzzerDriver());
  expect(validateDraftForCreate(draft)).toEqual([]);
  expect(builtinNfcDrivers().map((driver) => driver.id)).toContain(draft.id);
  expect(draft.commands.map((command) => command.label)).toEqual([
    "Accendi",
    "Spegni",
    "Beep breve",
  ]);
  const beep = draft.commands.find((command) => command.name === "beep")!;
  const compiled = compileRuntimeDriver(
    { ...draft, commands: [beep], flowInterfaces: [] },
    new Map(),
    new Map([["BUZZER", 1]]),
  );
  expect(compiled.profile.initOps).toContainEqual({
    op: "GPIO_SET",
    channel: 1,
    value: false,
  });
  expect(compiled.profile.sampleOps).toContainEqual({
    op: "GPIO_PULSE",
    channel: 1,
    milliseconds: 100,
    activeHigh: true,
    restoreHigh: false,
  });
  expect(compiled.profile.sampleOps.some((op) => op.op === "DELAY_BOUNDED")).toBe(
    false,
  );
  expect(draft.gpioHardware?.kind).toBe("buzzer");
});
