import type { ProjectV1 } from "@spaghettilab/domain";
import { withDs18b20PowerMode } from "./gpio-driver-presets.js";
import { BACKBONE_SENSOR_MODULES_META_KEY, parseBackboneSensorModules, upsertModule } from "./backbone-sensor-modules.js";
import { PHYSICAL_META_KEY, parsePhysicalProject } from "./backbone-physical.js";

export function configureDs18b20(project: ProjectV1, bindingId: string, moduleId: string,
  mode: "parasite" | "gpio", data: number, power: number, applied = false): ProjectV1 {
  if (![data, ...(mode === "gpio" ? [power] : [])].every(pin => Number.isInteger(pin) && pin >= 0 && pin < 4))
    throw new Error("Scegli un pin da A0 ad A3.");
  if (mode === "gpio" && data === power) throw new Error("DATA e VCC devono usare pin diversi.");
  const modules = parseBackboneSensorModules(project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment);
  const module = modules.byBinding[bindingId]?.find(item => item.id === moduleId);
  const draft = module?.recipe.deviceDraft;
  if (!module || draft?.temperatureSensorModel !== "ds18b20") throw new Error("DS18B20 non disponibile.");
  const boardKey = module.gpioAssignments?.boardKey ?? module.gpioAssignment?.boardKey;
  const physical = parsePhysicalProject(project.authoringMetadata[PHYSICAL_META_KEY]?.comment);
  const board = boardKey && physical.drafts[boardKey];
  if (!boardKey || !board || board.local === false) throw new Error("Assegna il sensore alla Backbone principale.");
  const channels: Record<string, number> = mode === "gpio" ? { DATA: data, POWER: power } : { DATA: data };
  const touched = Object.values(channels);
  for (const other of modules.byBinding[bindingId] ?? []) {
    if (other.id === moduleId) continue;
    const pins = other.gpioAssignments?.boardKey === boardKey ? Object.values(other.gpioAssignments.channels)
      : other.gpioAssignment?.boardKey === boardKey ? [other.gpioAssignment.channel] : [];
    if (pins.some(pin => touched.includes(pin))) throw new Error(`Pin già utilizzato da ${other.label}.`);
  }
  if (touched.some(pin => ((board.modes[pin] ?? 0) & 15) >= 4)) throw new Error("Uno dei pin selezionati è assegnato a un altro protocollo.");
  const modes = [...board.modes];
  modes[data] = 1;
  if (mode === "gpio") modes[power] = 2;
  const updatedDraft = withDs18b20PowerMode(draft, mode);
  const updated = { ...module, recipe: { ...module.recipe, deviceDraft: updatedDraft },
    actions: module.actions?.map(action => ({ ...action, deviceDraft: updatedDraft })),
    gpioAssignment: { boardKey, channel: data }, gpioAssignments: { boardKey, channels } };
  return { ...project, authoringMetadata: { ...project.authoringMetadata,
    [BACKBONE_SENSOR_MODULES_META_KEY]: { ...project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY], comment: JSON.stringify(upsertModule(modules, bindingId, updated)) },
    [PHYSICAL_META_KEY]: { ...project.authoringMetadata[PHYSICAL_META_KEY], comment: JSON.stringify({ ...physical, drafts: { ...physical.drafts, [boardKey]: { ...board, modes, applied, automatic: false } } }) },
  } };
}
