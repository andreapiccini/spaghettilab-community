import { saveDriverMetadata } from "./device-driver-library.js";
import type { ProjectV1 } from "@spaghettilab/domain";
import { findCatalogEntryById } from "@spaghettilab/processing-block-catalog";
import {
  BACKBONE_SENSOR_BLOCK_CATALOG_ID,
  propertiesForSensorModule,
} from "./backbone-sensor-block.js";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  createModuleFromRecipe,
  parseBackboneSensorModules,
  upsertModule,
} from "./backbone-sensor-modules.js";
import {
  draftToCanvasSensorRecipes,
  type DeviceRecipeDraft,
} from "./device-recipe-draft.js";
import {
  PHYSICAL_META_KEY,
  parsePhysicalProject,
  functionVariantOf,
  formatPinLabel,
  modeIndexToPinId,
} from "./backbone-physical.js";
import { nodeDataFromCatalogEntry } from "../components/processing-graph/catalog-to-node.js";
import { NFC_INSTALL_META } from "./nfc-workspace.js";
export type WiringLine = { signal: string; pin: string };
export type NfcWiring = {
  readonly variant: ReturnType<typeof functionVariantOf>;
  readonly physical: ReturnType<typeof parsePhysicalProject>["drafts"][string];
  readonly boardKey: string;
  readonly lines: readonly WiringLine[];
  readonly gpioAssignment?: { readonly boardKey: string; readonly channel: number };
};
export function nfcWiring(
  project: ProjectV1,
  bindingId: string,
  draft: DeviceRecipeDraft,
  voltage?: string,
  preferredGpio?: { readonly boardKey: string; readonly channel: number },
) {
  const all = Object.entries(
    parsePhysicalProject(project.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts,
  ).filter(([key]) => key.startsWith(`${bindingId}:`));
  const candidates = all.filter(
    ([, p]) => p.applied && (p.variant || [4, 8].includes(p.modes.length)),
  );
  if (!candidates.length)
    throw new Error(
      "Riconosci e applica la configurazione fisica della Backbone prima di collegare il modulo.",
    );
  if (!voltage || !["3.3V", "5V"].includes(voltage))
    throw new Error(
      "Indica l’alimentazione del modulo verificata nella sua documentazione.",
    );
  if (draft.binding.bus === "gpio") {
    const gpioPins = candidates.flatMap(([boardKey, physical]) => {
      const variant = functionVariantOf(physical);
      return physical.modes
        .map((mode, channel) => ({ mode, channel, boardKey, physical, variant }))
        .filter((pin) => [2, 3].includes(pin.mode & 15));
    });
    if (!gpioPins.length)
      throw new Error(
        "Serve almeno un pin digitale OUT applicato in Module Function per collegare il relè.",
      );
    const chosen =
      gpioPins.find(
        (pin) =>
          pin.boardKey === preferredGpio?.boardKey &&
          pin.channel === preferredGpio.channel,
      ) ?? gpioPins[0]!;
    const pin = formatPinLabel(
      modeIndexToPinId(chosen.channel, chosen.variant),
      chosen.variant,
    );
    const signal = draft.binding.gpioSignals[0]?.name ?? "RELAY";
    return {
      variant: chosen.variant,
      physical: chosen.physical,
      boardKey: chosen.boardKey,
      gpioAssignment: { boardKey: chosen.boardKey, channel: chosen.channel },
      lines: [
        { signal, pin },
        { signal: "VCC", pin: voltage },
        { signal: "GND", pin: "GND" },
      ] satisfies WiringLine[],
    };
  }
  if (draft.binding.bus !== "i2c")
    throw new Error(
      "Per questo protocollo completa il collegamento nel configuratore pin prima dell’installazione NFC. La guida automatica attuale supporta I²C.",
    );
  const buses = candidates.filter(
    ([, p]) =>
      p.modes.some((m) => (m & 15) === 4) && p.modes.some((m) => (m & 15) === 5),
  );
  if (buses.length !== 1)
    throw new Error(
      "Serve una sola porta I²C applicata con SDA e SCL. Controlla i pin occupati nel configuratore.",
    );
  const [boardKey, physical] = buses[0]!;
  const variant = functionVariantOf(physical);
  if (variant === "v1" && voltage === "3.3V")
    throw new Error(
      "Il connettore v1 espone solo 5 V. Per un modulo a 3.3 V serve un’alimentazione esterna adatta; non collegare VCC al pin 5 V.",
    );
  if (
    physical.modes.filter((m) => (m & 15) === 4).length !== 1 ||
    physical.modes.filter((m) => (m & 15) === 5).length !== 1
  )
    throw new Error("Mappatura SDA/SCL ambigua: correggi la configurazione fisica.");
  const pinFor = (mode: number) =>
    formatPinLabel(
      modeIndexToPinId(
        physical.modes.findIndex((m) => (m & 15) === mode),
        variant,
      ),
      variant,
    );
  return {
    variant,
    physical,
    boardKey,
    lines: [
      { signal: "SDA", pin: pinFor(4) },
      { signal: "SCL", pin: pinFor(5) },
      { signal: "VCC", pin: voltage },
      { signal: "GND", pin: "GND" },
    ] satisfies WiringLine[],
  };
}
export function installNfcDriver(
  project: ProjectV1,
  bindingId: string,
  uid: string,
  driver: DeviceRecipeDraft,
  version: string,
  voltage: string,
  preferredGpio?: { readonly boardKey: string; readonly channel: number },
  preparedWiring?: NfcWiring,
): ProjectV1 {
  const volts = ["3.3V", "5V"].includes(voltage) ? voltage : "5V";
  let wiring: NfcWiring | undefined;
  try {
    wiring =
      preparedWiring ?? nfcWiring(project, bindingId, driver, volts, preferredGpio);
  } catch (error) {
    if (driver.binding.bus !== "gpio") throw error;
  }
  const index = project.coreBindings.findIndex((b) => b.bindingId === bindingId);
  if (index < 0) throw new Error("Backbone non presente nel progetto.");
  const existing: Record<
    string,
    { bindingId: string; moduleId: string; version: string }
  > = JSON.parse(project.authoringMetadata[NFC_INSTALL_META]?.comment ?? "{}");
  const prior = existing[uid];
  if (prior) {
    if (prior.bindingId !== bindingId)
      throw new Error("Questo tag è già associato a un’altra Backbone nel progetto.");
    const nodes = project.deviceGraphs[index]?.nodes ?? [];
    if (
      nodes.some(
        (n) =>
          typeof n.data === "object" &&
          n.data !== null &&
          "properties" in n.data &&
          (n.data.properties as Record<string, unknown>).backboneSensorModuleId ===
            prior.moduleId,
      )
    )
      return project;
  }
  const modules = parseBackboneSensorModules(
    project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
  );
  if (driver.binding.bus === "i2c") {
    const address = Number.parseInt(driver.binding.i2c?.address ?? "", 16);
    const conflict = (modules.byBinding[bindingId] ?? []).find(
      (module) =>
        module.id !== `nfc-module-${uid}` &&
        module.bus === "i2c" &&
        Number.parseInt(module.recipe.address ?? "", 16) === address,
    );
    if (conflict)
      throw new Error(
        `Indirizzo I²C già usato da ${conflict.label}. Imposta un indirizzo differente nel driver del nuovo modulo.`,
      );
  }
  // Identity of the physical unit is distinct from the reusable library driver.
  const instance = {
    ...driver,
    id: `nfc-${uid}`,
    binding: {
      ...driver.binding,
      i2c:
        driver.binding.i2c && wiring
          ? {
              ...driver.binding.i2c,
              sdaLabel: wiring.lines[0]!.pin,
              sclLabel: wiring.lines[1]!.pin,
            }
          : driver.binding.i2c,
    },
  };
  const recipes = draftToCanvasSensorRecipes(instance);
  const recipe = recipes[0];
  const entry = findCatalogEntryById(BACKBONE_SENSOR_BLOCK_CATALOG_ID);
  const data = entry ? nodeDataFromCatalogEntry(entry, undefined) : null;
  if (!recipe || !data || data.kind !== "block")
    throw new Error("Il driver non contiene un’azione utilizzabile nel Flow.");
  const nodeId = `nfc-block-${uid}`;
  const module = {
    ...createModuleFromRecipe(recipe),
    label: driver.name,
    id: `nfc-module-${uid}`,
    actions: recipes,
    graphNodeId: nodeId,
    graphNodeIds: [nodeId],
    gpioAssignment: wiring?.gpioAssignment ?? preferredGpio,
  };
  const graph = project.deviceGraphs[index] ?? {
    layer: "device-processing" as const,
    nodes: [],
    edges: [],
  };
  const node = {
    layer: "device-processing" as const,
    id: nodeId,
    data: {
      ...data,
      properties: { ...data.properties, ...propertiesForSensorModule(module, recipe) },
    },
  };
  const graphs = [...project.deviceGraphs];
  graphs[index] = {
    ...graph,
    nodes: [...graph.nodes.filter((n) => n.id !== nodeId), node],
  };
  const stored = upsertModule(
    parseBackboneSensorModules(
      project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
    ),
    bindingId,
    module,
  );
  return {
    ...project,
    deviceGraphs: graphs,
    authoringMetadata: {
      ...saveDriverMetadata(project.authoringMetadata, driver),
      [BACKBONE_SENSOR_MODULES_META_KEY]: { comment: JSON.stringify(stored) },
      [NFC_INSTALL_META]: {
        comment: JSON.stringify({
          ...existing,
          [uid]: {
            bindingId,
            moduleId: module.id,
            driverId: driver.id,
            voltage: volts,
            version,
            boardKey: wiring?.boardKey ?? `${bindingId}`,
          },
        }),
      },
      [nodeId]: {
        comment: driver.name,
        position: {
          x: 160 + (graph.nodes.length % 4) * 240,
          y: 180 + Math.floor(graph.nodes.length / 4) * 160,
        },
      },
    },
  };
}
