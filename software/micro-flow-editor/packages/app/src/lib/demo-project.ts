import { addCoreBinding, coreBindingId, createEmptyProject, CommandStack, projectId, type ProjectV1 } from "@spaghettilab/domain";
import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import type { PhysicalCompositionNodeData } from "@spaghettilab/physical-composition-model";
import { findCatalogEntryById } from "@spaghettilab/processing-block-catalog";
import { addGraphEdgeCommand, addGraphNodeCommand, deviceGraphLens, physicalGraphLens, updateAuthoringMetadataCommand } from "@spaghettilab/react-flow-adapter";
import { nodeDataFromCatalogEntry } from "../components/processing-graph/catalog-to-node.js";

/** Schedule period for the demo — each tick toggles Digital Out → LED. */
export const DEMO_LED_PERIOD_MS = 1000;

export const DEMO_PROJECT_NAME = "Demo";

/**
 * A explorable, pre-populated project — no real Core behind it (the binding
 * has no connection profile, so "Connetti" on it will fail cleanly like any
 * other unreachable Core), just real structure so a new user can click
 * around Physical Composition/Processing Graph and see the UI with actual
 * data instead of empty states.
 *
 * Processing Graph: Schedule contains a fixed violet tick disc → Digital Out
 * Toggle (funzionalità). LED sits as a bay uscita to the right of the box.
 * The disc is system-owned (not from the palette, not movable); rewire its
 * output to any block inside the box to choose the entry. Dry-run toggles
 * the line each period.
 */
export function buildDemoProject(name: string): ProjectV1 | null {
  const idResult = projectId(crypto.randomUUID());
  const bindingIdResult = coreBindingId(crypto.randomUUID());
  if (!idResult.ok || !bindingIdResult.ok) return null;

  const stack = new CommandStack(createEmptyProject(idResult.value, name));

  const bindingResult = stack.execute(
    addCoreBinding({ bindingId: bindingIdResult.value, expectedDeviceId: "demo-core-0001", connectionProfileId: "demo" }),
  );
  if (!bindingResult.ok) return null;

  const physical = physicalGraphLens(0);
  const device = deviceGraphLens(0);

  function placePhysical(id: string, data: PhysicalCompositionNodeData, comment: string, position: { x: number; y: number }): boolean {
    const added = stack.execute(addGraphNodeCommand(physical, { layer: "physical-composition", id, data }));
    if (!added.ok) return false;
    const meta = stack.execute(updateAuthoringMetadataCommand(id, { comment, position }));
    return meta.ok;
  }

  if (!placePhysical("demo-backbone", { kind: "backbone", variant: "" }, "Backbone", { x: 80, y: 80 })) return null;
  if (!placePhysical("demo-power", { kind: "power-source", passive: false }, "Alimentazione", { x: 340, y: 80 })) return null;
  if (!placePhysical("demo-connector", { kind: "connector" }, "Connettore", { x: 600, y: 80 })) return null;
  if (!placePhysical("demo-external", { kind: "external-device" }, "Dispositivo esterno", { x: 80, y: 200 })) return null;
  const moduleId = "demo-module";
  if (!placePhysical(moduleId, { kind: "module", driverTypeId: "", portId: -1, bayId: -1, railId: -1, electricalMode: "input-output", properties: {} }, "Module", { x: 340, y: 200 })) return null;

  const scheduleEntry = findCatalogEntryById("native.schedule");
  const startEntry = findCatalogEntryById("native.flow_start");
  const toggleEntry = findCatalogEntryById("appblocks.digital_out_toggle");
  const ledEntry = findCatalogEntryById("appblocks.led");
  if (!scheduleEntry || !startEntry || !toggleEntry || !ledEntry) return null;

  const scheduleBase = nodeDataFromCatalogEntry(scheduleEntry, moduleId);
  const startBase = nodeDataFromCatalogEntry(startEntry, moduleId);
  const toggleBase = nodeDataFromCatalogEntry(toggleEntry, moduleId);
  const ledBase = nodeDataFromCatalogEntry(ledEntry, moduleId);
  if (!scheduleBase || !startBase || !toggleBase || !ledBase) return null;
  if (scheduleBase.kind !== "schedule" || startBase.kind !== "block" || toggleBase.kind !== "block" || ledBase.kind !== "block") return null;

  const scheduleData: DeviceProcessingNodeData = { ...scheduleBase, periodMs: DEMO_LED_PERIOD_MS, enabled: true };
  const startData: DeviceProcessingNodeData = startBase;
  const toggleData: DeviceProcessingNodeData = {
    ...toggleBase,
    properties: { ...toggleBase.properties, line: "LED" },
  };
  const ledData: DeviceProcessingNodeData = {
    ...ledBase,
    properties: { ...ledBase.properties, color: "#F5C518", bayRole: "output", bayFamilyId: "bay.led" },
  };

  function placeDevice(id: string, data: DeviceProcessingNodeData, comment: string, position: { x: number; y: number }): boolean {
    const added = stack.execute(addGraphNodeCommand(device, { layer: "device-processing", id, data }));
    if (!added.ok) return false;
    const meta = stack.execute(updateAuthoringMetadataCommand(id, { comment, position }));
    return meta.ok;
  }

  const scheduleId = "demo-schedule";
  const startId = "dp-tick-demo-schedule";
  const toggleId = "demo-toggle";
  const ledId = "demo-led";
  if (!placeDevice(scheduleId, scheduleData, "Schedule", { x: 40, y: 100 })) return null;
  // Fixed tick + Toggle inside Schedule; LED bay uscita outside to the right.
  if (!placeDevice(startId, startData, "", { x: 40, y: 86 })) return null;
  if (!placeDevice(toggleId, toggleData, "Digital Out Toggle", { x: 160, y: 160 })) return null;
  if (!placeDevice(ledId, ledData, "LED", { x: 420, y: 160 })) return null;
  if (!stack.execute(addGraphEdgeCommand(device, { id: "demo-edge-1", source: scheduleId, target: startId, sourceHandle: "0", targetHandle: "0" })).ok) return null;
  if (!stack.execute(addGraphEdgeCommand(device, { id: "demo-edge-2", source: startId, target: toggleId, sourceHandle: "0", targetHandle: "0" })).ok) return null;
  if (!stack.execute(addGraphEdgeCommand(device, { id: "demo-edge-3", source: toggleId, target: ledId, sourceHandle: "0", targetHandle: "0" })).ok) return null;

  return stack.current;
}
