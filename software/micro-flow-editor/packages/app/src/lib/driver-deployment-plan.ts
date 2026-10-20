import { whiteLedProperties } from "./white-led-module.js";
import { LOGIC_TYPES, logicProperties, requireLogicInputType } from "./logic-blocks.js";
import { signalDurations } from "./signal-timing.js";
import type { EdgeActivityRoute } from "./edge-activity.js";
import { scheduleForTrigger } from "./scheduled-triggers.js";
import { MANUAL_TRIGGER_TYPE, manualTriggerProfile } from "./flow-trigger.js";
import { rgbInputCommand } from "./rgb-runtime.js";
import {
  SEQUENCE_TYPE,
  MOVEMENT_COMPLETED,
  MOVEMENT_COMPLETED_FIELD,
  sequenceSteps,
  validateSequenceSteps,
  sequenceActionNodeId,
  encodeSequenceProgram,
} from "./flow-sequence.js";
import { gpioSignalType } from "./gpio-operation-registry.js";
import {
  SENSOR_INSTANCE_PROP,
  SENSOR_INPUT_PROP,
  SENSOR_OUTPUT_PROP,
  sensorInterfaces,
} from "./sensor-instance.js";
import type {
  CompileConfigInput,
  CompileConfigOptions,
} from "@spaghettilab/config-compiler";
import type { GraphNode, ProjectV1 } from "@spaghettilab/domain";
import {
  isModuleNodeData,
  type ModuleNodeData,
} from "@spaghettilab/physical-composition-model";
import {
  isBlockNodeData,
  type DeviceProcessingNodeData,
  type BlockNodeData,
} from "@spaghettilab/device-processing-graph-model";
import {
  findCatalogEntryById,
  findCatalogEntriesByTypeId,
} from "@spaghettilab/processing-block-catalog";
import type { DeviceProfileDraft } from "@spaghettilab/device-profile-authoring-model";
import { PortTransport } from "@spaghettilab/device-profile-authoring-model";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  modulesForBinding,
  parseBackboneSensorModules,
} from "./backbone-sensor-modules.js";
import {
  SENSOR_ACTION_ID_PROP,
  SENSOR_MODULE_ID_PROP,
  BACKBONE_SENSOR_BLOCK_TYPE_ID,
} from "./backbone-sensor-block.js";
import { PHYSICAL_META_KEY, parsePhysicalProject } from "./backbone-physical.js";
import {
  compileRuntimeDriver,
  stableDriverHash,
  type RuntimeAction,
} from "./driver-runtime-profile.js";
import {
  effectiveActionSteps,
  organizeDriverInterfaces,
  type DeviceRecipeDraft,
  type DeviceRecipeOp,
} from "./device-recipe-draft.js";
import {
  isMappedTrigger,
  mappedTriggerActionSteps,
  actionFixedWriteLevel,
  triggerActionNames,
} from "./gpio-trigger-map.js";

const SQUARE_WAVE_IDS = new Set(["appblocks.square_wave", "ab.square_wave"]);

function isSquareWaveNode(data: DeviceProcessingNodeData): boolean {
  if (data.kind !== "block") return false;
  return (
    SQUARE_WAVE_IDS.has(data.catalogEntryId ?? "") ||
    SQUARE_WAVE_IDS.has(data.blockTypeId)
  );
}

function squareWavePeriodMs(properties: Readonly<Record<string, unknown>>): number {
  const value = signalDurations(properties).periodMs;
  if (!Number.isInteger(value) || value < 20 || value > 60000)
    throw new Error("Generatore di segnali: la durata totale deve essere tra 20 millisecondi e 60 secondi.");
  return value;
}
function squareWavePulseMs(properties: Readonly<Record<string, unknown>>): number {
  const period = squareWavePeriodMs(properties);
  const { onMs, offMs } = signalDurations(properties);
  if (!Number.isInteger(onMs) || !Number.isInteger(offMs) || onMs < 1 || offMs < 1)
    throw new Error("Generatore di segnali: acceso e spento devono durare almeno 1 millisecondo.");
  return Math.min(period - 1, onMs);
}

function squareWavePulseSteps(
  nodeId: string,
  signalId: string,
  pulseMs: number,
  high: 0 | 1,
  low: 0 | 1,
  into: string,
): readonly DeviceRecipeOp[] {
  return [
    {
      id: `${nodeId}-pulse`,
      type: "gpio_pulse",
      signalId,
      activeState: high,
      restoreState: low,
      durationMs: { kind: "fixed", value: pulseMs },
    },
    { id: `${nodeId}-read`, type: "gpio_read", signalId, into },
  ];
}

type Node = GraphNode<"device-processing", string, DeviceProcessingNodeData>;
type Edge = CompileConfigInput["processingGraph"]["edges"][number];
export type DriverDeploymentPlan = {
  activityRoutes?: readonly EdgeActivityRoute[];
  signalObservations?: readonly { generatorId: string; key: number; field: number; schemaId?: string }[];
  input: CompileConfigInput;
  profiles: readonly DeviceProfileDraft[];
  options: CompileConfigOptions;
  observations?: readonly {
    viewerId: string;
    valueKind?: "digital" | "boolean" | "number" | "text";
    label?: string;
    unit?: string;
    key: number;
    field: number;
    action?: number;
    schemaId?: string;
  }[];
};
export function prepareDriverDeployment(
  project: ProjectV1,
  bindingId: string,
  input: CompileConfigInput,
): DriverDeploymentPlan {
  const viewerIds = new Set(
    (input.processingGraph.nodes as readonly Node[])
      .filter(
        (node) =>
          node.data.kind === "block" && node.data.blockTypeId === "ui.data_viewer",
      )
      .map((node) => node.id),
  );
  const viewerEdges = input.processingGraph.edges.filter((edge) =>
    viewerIds.has(edge.target),
  );
  for (const id of viewerIds)
    if (viewerEdges.filter((edge) => edge.target === id).length > 1)
      throw new Error(
        "Visualizza dati: collega una sola uscita a ciascun visualizzatore.",
      );
  input = {
    ...input,
    processingGraph: {
      ...input.processingGraph,
      nodes: input.processingGraph.nodes.filter((node) => !viewerIds.has(node.id)),
      edges: input.processingGraph.edges.filter(
        (edge) => !viewerIds.has(edge.target) && !viewerIds.has(edge.source),
      ),
    },
  };
  input = {
    ...input,
    processingGraph: {
      ...input.processingGraph,
      nodes: (input.processingGraph.nodes as readonly Node[]).map((node) => {
        if (
          node.data.kind !== "block" ||
          !node.data.properties.statusLed ||
          !["ab.led", "status_led"].includes(node.data.blockTypeId)
        )
          return node;
        const p = node.data.properties;
        for (const field of [
          "delayOnMs",
          "delayOffMs",
          "softStartMs",
          "softStopMs",
          "softOnMs",
          "softOffMs",
        ])
          if (Number(p[field] ?? 0) !== 0)
            throw new Error(
              "STATUS: usa il controllo digitale senza ritardi o dissolvenze.",
            );
        return {
          ...node,
          data: {
            ...node.data,
            blockTypeId: "status_led",
            properties: whiteLedProperties(p),
          },
        };
      }),
    },
  };
  const originalNodes = input.processingGraph.nodes as readonly Node[];
  const manualTriggers = originalNodes.filter(
    (node) =>
      node.data.kind === "block" && node.data.blockTypeId === MANUAL_TRIGGER_TYPE,
  );
  const sequences = originalNodes.filter(
    (node) => node.data.kind === "block" && node.data.blockTypeId === SEQUENCE_TYPE,
  );
  const synthetic = new Map<string, Node>();
  for (const node of sequences) {
    const steps = sequenceSteps((node.data as BlockNodeData).properties);
    validateSequenceSteps(steps);
    for (const step of steps)
      if (step.kind === "action") {
        const id = sequenceActionNodeId(step.moduleId, step.actionId);
        synthetic.set(id, {
          layer: "device-processing",
          id,
          data: {
            kind: "block",
            blockTypeId: BACKBONE_SENSOR_BLOCK_TYPE_ID,
            properties: {
              [SENSOR_MODULE_ID_PROP]: step.moduleId,
              [SENSOR_ACTION_ID_PROP]: step.actionId,
            },
          },
        });
      }
  }
  const nodes: readonly Node[] = [...originalNodes, ...synthetic.values()];
  const sensorNodes = nodes.filter(
    (node): node is Node & { data: BlockNodeData } =>
      node.data.kind === "block" &&
      node.data.blockTypeId === BACKBONE_SENSOR_BLOCK_TYPE_ID,
  );
  if (
    !sensorNodes.length &&
    !sequences.length &&
    !viewerEdges.length &&
    !manualTriggers.length &&
    !originalNodes.some(node => node.data.kind === "block" && LOGIC_TYPES.has(node.data.blockTypeId))
  )
    return { input, profiles: [], options: {} };
  const stored = modulesForBinding(
    parseBackboneSensorModules(
      project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
    ),
    bindingId,
  );
  const logicInputTypes = new Map<string, string>();
  for (const node of originalNodes) {
    if (node.data.kind !== "block" || !LOGIC_TYPES.has(node.data.blockTypeId)) continue;
    const count = ["logic_and", "logic_or"].includes(node.data.blockTypeId) ? 2 : 1;
    for (let port = 0; port < count; port++) {
      const wires = input.processingGraph.edges.filter(edge => edge.target === node.id && (edge.targetHandle ?? "0") === String(port));
      if (wires.length !== 1) throw new Error(`${node.data.blockTypeId.replace("logic_", "").toUpperCase()}: collega una sola sorgente all’ingresso ${port + 1}.`);
      const edge = wires[0]!;
      const source = originalNodes.find(source => source.id === edge.source);
      if (!source) throw new Error("Logica: sorgente non disponibile.");
      const sd = source.data;
      if (sd.kind === "block" && sd.blockTypeId === BACKBONE_SENSOR_BLOCK_TYPE_ID) {
        const metadata = stored.find(module => module.id === sd.properties[SENSOR_MODULE_ID_PROP]);
        const channel = metadata?.recipe.deviceDraft?.channels.find(channel => channel.id === edge.sourceHandle);
        requireLogicInputType(node.data.blockTypeId.replace("logic_", "").toUpperCase(), channel?.quantity === "digital" ? "digital" : channel?.dataType);
        logicInputTypes.set(node.id, channel?.quantity === "digital" ? "digital" : channel?.dataType ?? "int");
      } else if (sd.kind === "block" && !LOGIC_TYPES.has(sd.blockTypeId) && sd.blockTypeId !== MANUAL_TRIGGER_TYPE) {
        const entry = findCatalogEntryById(sd.catalogEntryId ?? "") ?? findCatalogEntriesByTypeId(sd.blockTypeId)[0];
        const output = entry?.outputs?.find(port => port.id === (edge.sourceHandle ?? "0"));
        const type = sd.blockTypeId === "status_led" ? (edge.sourceHandle === "1" ? "number" : "digital") : output?.types.every(type => ["digital", "event", "activation"].includes(type.domain)) ? "digital" : output?.types.every(type => type.domain === "analog" || type.domain === "quantity") ? "number" : output?.types.every(type => type.domain === "text") ? "string" : undefined;
        requireLogicInputType(node.data.blockTypeId.replace("logic_", "").toUpperCase(), type);
        if (type) logicInputTypes.set(node.id, type);
      }
    }
  }
  const applied = Object.entries(
    parsePhysicalProject(project.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts,
  ).filter(([key, value]) => key.startsWith(`${bindingId}:`) && value.applied);
  const portId = applied[0]?.[1].backendPortId ?? 0;
  const physical = [...input.physicalGraph.nodes];
  const profiles: DeviceProfileDraft[] = [];
  const viewerGpioSources = new Map<string, { moduleId: string; field: number }>();
  const viewerPresentation = new Map<string, { valueKind: "digital" | "boolean" | "number" | "text"; label: string; unit: string }>();
  for (const edge of viewerEdges) {
    const source = originalNodes.find(node => node.id === edge.source);
    if (source?.data.kind === "block" && source.data.blockTypeId === "logic_if")
      viewerPresentation.set(edge.id, { valueKind: "digital", label: "", unit: "" });
    if (source?.data.kind === "block" && source.data.blockTypeId === "status_led")
      viewerPresentation.set(edge.id, { valueKind: edge.sourceHandle === "1" ? "number" : "boolean", label: "", unit: "" });
  }
  const runtime = new Map<
    string,
    { moduleId: string; action: RuntimeAction; triggerHandle?: string }
  >();
  const generated = new Map<string, Node>();
  for (const node of originalNodes) if (node.data.kind === "block" && LOGIC_TYPES.has(node.data.blockTypeId))
    generated.set(node.id, { ...node, data: { ...node.data, properties: logicProperties(node.data.blockTypeId, node.data.properties, logicInputTypes.get(node.id)) } });
  const squareDriven = new Set<string>();
  const scheduledActions = new Map<string, string>();
  const squareWaveModules = new Map<string, { moduleId: string; periodMs: number }[]>();
  const gpioOwners = new Set<string>();
  const motionModules = new Set<string>();
  const rgbTargets = new Map<string, DeviceRecipeDraft>();
  const originalEdges = [...input.processingGraph.edges];
  const aliases = new Map<string, string>();
  // The violet activation disc is authoring-only: its source is the real schedule.
  for (const node of nodes)
    if (node.data.kind === "block" && node.data.blockTypeId === "ab.flow_start") {
      const incoming = originalEdges.filter((edge) => edge.target === node.id);
      if (incoming.length !== 1)
        throw new Error(`Attivazione «${node.id}»: collega un solo trigger.`);
      aliases.set(node.id, incoming[0]!.source);
    }
  const resolveAlias = (id: string): string => {
    const seen = new Set<string>();
    while (aliases.has(id)) {
      if (seen.has(id)) throw new Error("Ciclo nei trigger del Flow.");
      seen.add(id);
      id = aliases.get(id)!;
    }
    return id;
  };
  const scheduledTriggers = new Map<string, string>();
  for (const node of manualTriggers) {
    const owner = scheduleForTrigger(input.processingGraph, node.id);
    if (owner) scheduledTriggers.set(node.id, owner.id);
  }
  const edges = originalEdges
    .filter((edge) => !aliases.has(edge.target) && !scheduledTriggers.has(edge.target))
    .flatMap((edge) => {
      const resolved = { ...edge, source: resolveAlias(edge.source) };
      const schedule = scheduledTriggers.get(edge.source);
      // Keep the independent manual command path for one-shot mode. A clock
      // record fires the same action in continuous mode; no UI block is polled.
      return schedule
        ? [resolved, { ...edge, id: `${edge.id}:scheduled`, source: schedule }]
        : [resolved];
    });
  // A legacy direct clock wire and a contained trigger can describe the same
  // activation while a user rearranges the canvas. Emit that activation once.
  const scheduledSources = new Set(scheduledTriggers.values());
  const scheduledRoutes = new Set<string>();
  for (let i = edges.length - 1; i >= 0; i--) {
    const edge = edges[i]!;
    if (!scheduledSources.has(edge.source)) continue;
    const route = `${edge.source}:${edge.target}:${edge.targetHandle ?? ""}`;
    if (scheduledRoutes.has(route)) edges.splice(i, 1);
    else scheduledRoutes.add(route);
  }
  const graphIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  for (const edge of originalEdges) {
    if (!graphIds.has(edge.source) || !graphIds.has(edge.target))
      throw new Error(`Il filo «${edge.id}» contiene un blocco non disponibile.`);
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id))
      throw new Error(
        "Il Flow contiene un ciclo: interrompilo con un’attivazione esterna.",
      );
    if (visited.has(id)) return;
    visiting.add(id);
    (adjacency.get(id) ?? []).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  graphIds.forEach(visit);
  const module = (id: string, data: ModuleNodeData) => {
    if (physical.some((node) => node.id === id))
      throw new Error(`Identità runtime duplicata: ${id}`);
    physical.push({ layer: "physical-composition", id, data });
  };
  const groupIds = [
    ...new Set(
      sensorNodes.map((node) =>
        String(node.data.properties[SENSOR_MODULE_ID_PROP] ?? ""),
      ),
    ),
  ].sort();
  for (const groupId of groupIds) {
    const metadata = stored.find((item) => item.id === groupId);
    const savedDraft =
      metadata?.recipe.deviceDraft ??
      metadata?.actions?.find((action) => action.deviceDraft)?.deviceDraft;
    const draft = savedDraft ? organizeDriverInterfaces(savedDraft) : undefined;
    if (!draft)
      throw new Error(
        `Il sensore «${groupId}» non contiene il driver completo: rigenera i blocchi da Dispositivi.`,
      );
    const gpioChannels = new Map<string, number>();
    let driverPortId: number;
    if (draft.binding.bus === "gpio") {
      const multi = metadata?.gpioAssignments;
      if (draft.binding.gpioSignals.length > 1) {
        if (!multi)
          throw new Error(`${draft.name}: assegna i segnali dalla sezione Moduli.`);
        const config = applied.find(([key]) => key === multi.boardKey)?.[1];
        if (!config || config.local === false)
          throw new Error(`${draft.name}: applica i pin richiesti sul master.`);
        driverPortId = config.backendPortId ?? 0;
        const used = new Set<number>();
        for (const signal of draft.binding.gpioSignals) {
          const channel = multi.channels[signal.id];
          if (
            !Number.isInteger(channel) ||
            channel! < 0 ||
            channel! > 3 ||
            used.has(channel!) ||
            !(
              draft.rgbModule
                ? [12]
                : draft.dht22Module && signal.id === "DATA"
                  ? [1]
                  : [2, 3]
            ).includes((config.modes[channel!] ?? 0) & 15)
          )
            throw new Error(
              `${draft.name}: i segnali richiedono pin distinti, configurati con la funzione corretta.`,
            );
          used.add(channel!);
          gpioChannels.set(signal.id, channel!);
          const ownerKey = `${driverPortId}:${channel}`;
          if (gpioOwners.has(ownerKey))
            throw new Error(`${draft.name}: pin già assegnato a un altro dispositivo.`);
          gpioOwners.add(ownerKey);
        }
      } else {
        if (draft.binding.gpioSignals.length !== 1)
          throw new Error(`${draft.name}: usa un segnale digitale per dispositivo.`);
        const signal = draft.binding.gpioSignals[0]!;
        const output = gpioSignalType(signal) === "digital_output";
        const candidates = applied
          .filter(
            ([key, config]) =>
              config.local !== false &&
              (!metadata?.gpioAssignment || key === metadata.gpioAssignment.boardKey),
          )
          .flatMap(([, config]) =>
            config.modes
              .slice(0, 4)
              .flatMap((mode, channel) =>
                (output ? [2, 3].includes(mode & 15) : (mode & 15) === 1) &&
                (!metadata?.gpioAssignment ||
                  channel === metadata.gpioAssignment.channel)
                  ? [{ portId: config.backendPortId ?? 0, channel }]
                  : [],
              ),
          );
        if (candidates.length !== 1)
          throw new Error(
            `${draft.name}: assegna DATA a un ${output ? "output" : "input"} digitale applicato nel Module Function.`,
          );
        driverPortId = candidates[0]!.portId;
        gpioChannels.set(signal.id, candidates[0]!.channel);
        // An explicit driver owns this line instead of the auto-generated raw-input module.
        for (let i = physical.length - 1; i >= 0; --i) {
          const node = physical[i]!;
          const data = node.data as ModuleNodeData;
          if (
            node.id.startsWith("physical-pin:") &&
            data.driverTypeId === "digital_input_trigger" &&
            data.portId === driverPortId &&
            Number(data.properties["1"]) === candidates[0]!.channel
          )
            physical.splice(i, 1);
        }
        const ownerKey = `${driverPortId}:${candidates[0]!.channel}`;
        if (gpioOwners.has(ownerKey))
          throw new Error(
            `${draft.name}: questo pin è già assegnato a un altro dispositivo.`,
          );
        gpioOwners.add(ownerKey);
      }
    } else {
      const ports = [
        ...new Set(
          applied
            .filter(
              ([, config]) =>
                config.modes.some((mode) => (mode & 15) === 4) &&
                config.modes.some((mode) => (mode & 15) === 5),
            )
            .map(([, config]) => config.backendPortId ?? 0),
        ),
      ];
      if (ports.length !== 1)
        throw new Error(
          "Applica una porta I²C univoca (SDA e SCL) nel Module Function prima di Deploy & Run.",
        );
      driverPortId = ports[0]!;
    }
    const instances = sensorNodes
      .filter((node) => node.data.properties[SENSOR_MODULE_ID_PROP] === groupId)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const instance of instances) for (const edge of [
      ...viewerEdges.filter(edge => edge.source === instance.id),
      ...edges.filter(edge => edge.target === instance.id && isSquareWaveNode(nodes.find(node => node.id === edge.source)?.data ?? { kind: "block", blockTypeId: "", properties: {} })).map(edge => ({ ...edge, id: `signal-preview:${edge.id}`, source: instance.id, sourceHandle: String(instance.data.properties[SENSOR_OUTPUT_PROP] ?? sensorInterfaces(draft).outputs[0]?.channelId ?? "") })),
    ]) {
      const channel = draft.channels.find(channel => channel.id === edge.sourceHandle);
      if (!channel) continue;
      const digital = channel.quantity === "digital";
      viewerPresentation.set(edge.id, { label: channel.label, unit: channel.unit ?? "",
        valueKind: digital ? "digital" : channel.dataType === "bool" ? "boolean" : channel.dataType === "string" ? "text" : "number" });
      if (!digital || draft.binding.bus !== "gpio") continue;
      const published = sensorInterfaces(draft).outputs.find(output => output.channelId === channel.id);
      const read = draft.commands.flatMap(command => command.steps).find(step => step.type === "gpio_read" && step.into === published?.from);
      if (!read || read.type !== "gpio_read") continue;
      const observerId = `gpio-state:${groupId}:${read.signalId}`;
      if (!physical.some(node => node.id === observerId)) {
        const observerDraft: DeviceRecipeDraft = { ...draft,
          binding: { ...draft.binding, gpioSignals: draft.binding.gpioSignals.map(signal => ({ ...signal, activeLow: false })) },
          phases: { ...draft.phases, init: [] }, flowInterfaces: [], flowInterfaceActions: {},
          commands: [{ ...draft.commands[0]!, id: "observe", steps: [
            { id: "state-read", type: "gpio_read", signalId: read.signalId, into: "pinState" },
            { id: "state-emit", type: "emit", channelId: channel.id, from: "pinState" },
          ] }],
        };
        const observed = compileRuntimeDriver(observerDraft, new Map(), gpioChannels).profile;
        const profileId = `flow.gpio-state.${observed.profileId}`;
        profiles.push({ ...observed, profileId, sampleSchemaId: `${profileId}.s` });
        module(observerId, { kind: "module", driverTypeId: "declarative-device", profileId,
          portId: driverPortId, bayId: 255, railId: 255, electricalMode: "input-output",
          properties: { "1": profileId, "2": 1n } });
        generated.set(observerId, { layer: "device-processing", id: observerId,
          data: { kind: "schedule", moduleNodeId: observerId, periodMs: 100, enabled: true } });
      }
      viewerGpioSources.set(edge.id, { moduleId: observerId, field: 1 });
    }
    if (draft.rgbModule) {
      const compiled = compileRuntimeDriver(draft, new Map(), gpioChannels);
      profiles.push(compiled.profile);
      const moduleId = `driver:${groupId}`;
      module(moduleId, {
        kind: "module",
        driverTypeId: "declarative-device",
        profileId: compiled.profile.profileId,
        portId: driverPortId,
        bayId: 255,
        railId: 255,
        electricalMode: "input-output",
        properties: { "1": compiled.profile.profileId, "2": 1n },
      });
      generated.set(`driver-rgb:${groupId}`, {
        layer: "device-processing",
        id: `driver-rgb:${groupId}`,
        data: {
          kind: "schedule",
          moduleNodeId: moduleId,
          periodMs: 100,
          enabled: true,
        },
      });
      for (const node of instances) {
        const actionId = String(
          node.data.properties[SENSOR_ACTION_ID_PROP] ?? draft.commands[0]!.id,
        );
        const action = compiled.actions.get(actionId);
        if (!action) throw new Error("L’azione RGB non esiste più.");
        runtime.set(node.id, { moduleId, action });
        rgbTargets.set(node.id, draft);
        generated.set(node.id, {
          ...node,
          data: { kind: "event-source", moduleNodeId: moduleId },
        });
      }
      continue;
    }
    const connected = new Map<string, ReadonlySet<string>>();
    const channels = [...draft.channels];
    const commands = instances.map((node) => {
      const action = draft.commands.find(
        (command) => command.id === node.data.properties[SENSOR_ACTION_ID_PROP],
      );
      if (!action)
        throw new Error(`L’azione del blocco «${node.id}» non esiste più: rigeneralo.`);
      const single = node.data.properties[SENSOR_INSTANCE_PROP] === true;
      const selectedInput = String(node.data.properties[SENSOR_INPUT_PROP] ?? "");
      const selectedOutput = String(node.data.properties[SENSOR_OUTPUT_PROP] ?? "");
      const { inputs: interfaces, outputs: outputInterfaces } = sensorInterfaces(draft);
      const triggerInput = interfaces.find(
        (step) => step.fromChannelId === selectedInput && step.inputMode === "trigger",
      );
      const mappedTrigger = triggerInput ? isMappedTrigger(triggerInput) : false;
      const trigger =
        selectedInput === "execute" || (Boolean(triggerInput) && !mappedTrigger);
      if (
        single &&
        selectedInput &&
        selectedInput !== "execute" &&
        !interfaces.some((step) => step.fromChannelId === selectedInput)
      )
        throw new Error(
          `L’ingresso selezionato nel blocco «${node.id}» non esiste più.`,
        );
      if (
        single &&
        selectedOutput &&
        !outputInterfaces.some((step) => step.channelId === selectedOutput)
      )
        throw new Error(`L’uscita selezionata nel blocco «${node.id}» non esiste più.`);
      const inIds = single
        ? new Set(selectedInput ? [selectedInput] : [])
        : new Set(
            effectiveActionSteps(draft, action).flatMap((step) =>
              step.type === "sample_external" ? [step.fromChannelId] : [],
            ),
          );
      const incoming = edges.filter((edge) => edge.target === node.id);
      if (draft.dht22Module) inIds.add("read-trigger");
      const squareSource = incoming
        .map((edge) => nodes.find((item) => item.id === edge.source))
        .find((source) => source && isSquareWaveNode(source.data));
      if (squareSource && draft.binding.bus === "gpio") {
        if (!mappedTrigger || !triggerInput)
          throw Object.assign(
            new Error(
              `${draft.name}: collega l’onda a un ingresso comando con azioni HIGH e LOW associate.`,
            ),
            {
              nodeId: node.id,
              code: action.steps.some(
                (step) => step.type === "stepper" && step.command === "start",
              )
                ? "wave-stepper-start"
                : "wave-trigger",
            },
          );
        const names = triggerActionNames(triggerInput);
        for (const name of [names.high, names.low]) {
          const selected = draft.commands.find((command) => command.name === name);
          if (
            !selected ||
            actionFixedWriteLevel(draft, name) === undefined ||
            selected.steps.some(
              (step) => !["gpio_write", "gpio_read", "emit"].includes(step.type),
            ) ||
            selected.steps.filter((step) => step.type === "gpio_write").length !== 1
          )
            throw new Error(
              `${draft.name}: l’onda richiede due azioni digitali semplici; l’azione «${name}» contiene altri passi e non viene sostituita.`,
            );
        }
        if (scheduledActions.has(groupId) && scheduledActions.get(groupId) !== node.id)
          throw new Error(`${draft.name}: usa una sola onda per questo pin.`);
        scheduledActions.set(groupId, node.id);
        squareDriven.add(node.id);
        const periodMs = isBlockNodeData(squareSource.data)
          ? squareWavePeriodMs(squareSource.data.properties)
          : 500;
        const clockModuleId = `driver:${groupId}`;
        const clocks = squareWaveModules.get(squareSource.id) ?? [];
        if (!clocks.some((item) => item.moduleId === clockModuleId))
          clocks.push({ moduleId: clockModuleId, periodMs });
        squareWaveModules.set(squareSource.id, clocks);
      }
      for (const edge of incoming)
        if (
          !(single
            ? inIds.has(edge.targetHandle ?? "")
            : edge.targetHandle === "execute" || inIds.has(edge.targetHandle ?? ""))
        )
          throw new Error(
            `Ingresso «${edge.targetHandle}» non disponibile nel blocco «${node.id}».`,
          );
      for (const id of inIds)
        if (
          incoming.filter((edge) => edge.targetHandle === id).length > 1 &&
          !interfaces.some(
            (input) => input.fromChannelId === id && input.inputMode === "trigger",
          )
        )
          throw new Error(`Ingresso «${id}»: collega una sola sorgente.`);
      const sharedWiredInputs = instances.flatMap((instance) =>
        edges
          .filter(
            (edge) =>
              edge.target === instance.id &&
              interfaces.some(
                (input) =>
                  input.inputMode !== "trigger" &&
                  input.fromChannelId === edge.targetHandle,
              ),
          )
          .flatMap((edge) => (edge.targetHandle ? [edge.targetHandle] : [])),
      );
      connected.set(
        node.id,
        new Set([
          ...(synthetic.has(node.id)
            ? interfaces
                .filter((input) => input.inputMode !== "trigger")
                .map((input) => input.fromChannelId)
            : []),
          ...(single ? sharedWiredInputs : []),
          ...incoming.flatMap((edge) =>
            edge.targetHandle &&
            !(trigger && edge.targetHandle === selectedInput) &&
            edge.targetHandle !== "execute"
              ? [edge.targetHandle]
              : [],
          ),
        ]),
      );
      const squarePulse =
        squareSource &&
        isBlockNodeData(squareSource.data) &&
        draft.binding.bus === "gpio" &&
        draft.binding.gpioSignals[0]
          ? squareWavePulseSteps(
              node.id,
              draft.binding.gpioSignals[0].id,
              squareWavePulseMs(squareSource.data.properties),
              actionFixedWriteLevel(draft, triggerActionNames(triggerInput!).high)!,
              actionFixedWriteLevel(draft, triggerActionNames(triggerInput!).low)!,
              outputInterfaces.find((step) => step.channelId === selectedOutput)
                ?.from ??
                draft.variables[0]?.name ??
                "stato",
            )
          : undefined;
      const effective = squarePulse
        ? squarePulse
        : mappedTrigger
          ? mappedTriggerActionSteps(draft, triggerInput!)
          : effectiveActionSteps(draft, action);
      const selectedEmit = outputInterfaces.find(
        (step) => step.channelId === selectedOutput,
      );
      const body = single
        ? [
            ...effective.filter((step) => step.type !== "emit"),
            ...(selectedEmit ? [selectedEmit] : []),
          ]
        : effective;
      const steps = body.map((step) => {
        if (step.type !== "emit") return step;
        const id = `${node.id}/${step.channelId}`;
        const channel = draft.channels.find((item) => item.id === step.channelId);
        if (!channel) throw new Error(`Uscita «${step.channelId}» non definita.`);
        if (!channels.some((item) => item.id === id)) channels.push({ ...channel, id });
        return { ...step, channelId: id };
      });
      return { ...action, id: node.id, steps };
    });
    const driverDraft: DeviceRecipeDraft = {
      ...draft,
      commands,
      channels,
      flowInterfaces: [],
      flowInterfaceActions: {},
    };
    const compiled = compileRuntimeDriver(
      driverDraft,
      connected,
      gpioChannels,
      scheduledActions.get(groupId),
    );
    profiles.push(compiled.profile);
    const moduleId = `driver:${groupId}`;
    if (
      draft.commands.some((command) =>
        command.steps.some((op) => op.type === "stepper"),
      )
    ) {
      motionModules.add(moduleId);
      const id = `driver-motion:${groupId}`;
      generated.set(id, {
        layer: "device-processing",
        id,
        data: {
          kind: "schedule",
          moduleNodeId: moduleId,
          periodMs: 20,
          enabled: true,
        },
      });
    }
    if (draft.dht22Module) {
      const id = `driver-dht22:${groupId}`;
      generated.set(id, {
        layer: "device-processing",
        id,
        data: {
          kind: "schedule",
          moduleNodeId: moduleId,
          periodMs: 100,
          enabled: true,
        },
      });
    }
    const address = Number.parseInt(
      draft.binding.i2c?.address.replace(/^0x/i, "") ?? "",
      16,
    );
    if (
      draft.binding.bus === "i2c" &&
      (!Number.isInteger(address) ||
        address < 8 ||
        address > 0x77 ||
        (draft.binding.i2c?.addressBits ?? 7) !== 7)
    )
      throw new Error(
        `${draft.name}: il runtime richiede un indirizzo I²C a 7 bit tra 0x08 e 0x77.`,
      );
    if (
      draft.binding.bus === "i2c" &&
      physical.some((node) => {
        const data = node.data as ModuleNodeData;
        return (
          isModuleNodeData(data) &&
          data.portId === driverPortId &&
          (data.endpoint?.address === address ||
            Number(data.properties["4"]) === address)
        );
      })
    )
      throw new Error(`${draft.name}: l’indirizzo I²C è già usato da un altro modulo.`);
    module(moduleId, {
      kind: "module",
      driverTypeId: "declarative-device",
      profileId: compiled.profile.profileId,
      portId: driverPortId,
      bayId: 255,
      railId: 255,
      ...(draft.binding.bus === "i2c" ? { endpoint: { address } } : {}),
      electricalMode: "input-output",
      properties: {
        "1": compiled.profile.profileId,
        "2": 1n,
        ...(draft.binding.bus === "i2c" ? { "4": BigInt(address) } : {}),
      },
    });
    for (const node of instances) {
      const info = compiled.actions.get(node.id)!;
      const outputIds = Object.fromEntries(
        Object.entries(info.outputIds).map(([id, value]) => [
          id.slice(node.id.length + 1),
          value,
        ]),
      );
      const selectedInput = String(node.data.properties[SENSOR_INPUT_PROP] ?? "");
      const isTrigger = sensorInterfaces(draft).inputs.some(
        (step) =>
          step.fromChannelId === selectedInput &&
          step.inputMode === "trigger" &&
          !isMappedTrigger(step),
      );
      runtime.set(node.id, {
        moduleId,
        action: { ...info, outputIds },
        ...(isTrigger || squareDriven.has(node.id)
          ? { triggerHandle: selectedInput || "comando" }
          : {}),
      });
      generated.set(node.id, {
        ...node,
        data: { kind: "event-source", moduleNodeId: moduleId },
      });
    }
  }

  for (const node of nodes) {
    const gpioClocks = squareWaveModules.get(node.id);
    if (
      isSquareWaveNode(node.data) &&
      (!gpioClocks?.length ||
        edges.some((edge) => edge.source === node.id && !squareDriven.has(edge.target)))
    )
      throw new Error(
        "Collega l’onda quadra direttamente a un ingresso comando di un dispositivo GPIO. Questo collegamento non è ancora supportato.",
      );
    if (gpioClocks?.length && isSquareWaveNode(node.data)) {
      const [primary] = gpioClocks;
      generated.set(node.id, {
        ...node,
        data: {
          kind: "schedule",
          moduleNodeId: primary!.moduleId,
          periodMs: primary!.periodMs,
          enabled: true,
        },
      });
      continue;
    }
    const isPeriod =
      node.data.kind === "schedule" ||
      (node.data.kind === "event-source" &&
        node.data.catalogEntryId === "appblocks.time_interval") ||
      isSquareWaveNode(node.data);
    if (isPeriod) {
      const periodMs =
        isSquareWaveNode(node.data) && isBlockNodeData(node.data)
          ? squareWavePeriodMs(node.data.properties)
          : node.data.kind === "schedule"
            ? node.data.periodMs
            : Number(
                (node.data as { properties?: Record<string, unknown> }).properties
                  ?.periodSec ?? 1,
              ) * 1000;
      if (!Number.isInteger(periodMs) || periodMs < 1 || periodMs > 60000)
        throw new Error("Il periodo deve essere un intero tra 1 e 60000 ms.");
      const id = `driver-clock:${node.id}`;
      const profile: DeviceProfileDraft = {
        profileId: "flow.clock",
        version: 1,
        transport: PortTransport.LOGICAL,
        requiredCapabilities: 0,
        maxTotalTimeMs: 1,
        maxTransactions: 0,
        maxBytes: 0,
        initOps: [],
        sampleOps: [
          { op: "LOAD_CONST", dst: 0, length: 1, low: 1, high: 0 },
          {
            op: "EMIT_FIELD",
            src: 0,
            fieldId: 1,
            width: 1,
            byteOrder: "le",
            signExtend: false,
            multiplier: 0,
          },
          { op: "EMIT_RECORD" },
        ],
        safeStopOps: [],
        sampleSchemaId: "flow.clock.tick",
        sampleSchemaVersion: 1,
        sampleFields: [{ fieldId: 1, type: "uint64", name: "tick", unit: "" }],
      };
      if (!profiles.some((profile) => profile.profileId === "flow.clock"))
        profiles.push(profile);
      module(id, {
        kind: "module",
        driverTypeId: "declarative-device",
        profileId: profile.profileId,
        portId,
        bayId: 255,
        railId: 255,

        electricalMode: "input-only",
        properties: { "1": profile.profileId, "2": 1n },
      });
      generated.set(node.id, {
        ...node,
        data: {
          kind: "schedule",
          moduleNodeId: id,
          periodMs,
          enabled: node.data.kind === "schedule" ? node.data.enabled : true,
        },
      });
    } else if (
      node.data.kind === "event-source" &&
      node.data.catalogEntryId === "appblocks.system"
    ) {
      const id = "driver-on-boot";
      if (!physical.some((node) => node.id === id))
        module(id, {
          kind: "module",
          driverTypeId: "on_boot",
          portId,
          bayId: 255,
          railId: 255,
          electricalMode: "input-only",
          properties: {},
        });
      generated.set(node.id, {
        ...node,
        data: { kind: "event-source", moduleNodeId: id },
      });
    }
  }
  for (const node of manualTriggers) {
    const profile = manualTriggerProfile(node.id);
    profiles.push(profile);
    const id = `driver-manual:${node.id}`;
    module(id, {
      kind: "module",
      driverTypeId: "declarative-device",
      profileId: profile.profileId,
      portId,
      bayId: 255,
      railId: 255,
      electricalMode: "input-only",
      properties: { "1": profile.profileId, "2": 1n },
    });
    generated.set(node.id, {
      ...node,
      data: { kind: "event-source", moduleNodeId: id },
    });
    generated.set(`${id}:armed`, {
      layer: "device-processing",
      id: `${id}:armed`,
      data: { kind: "schedule", moduleNodeId: id, periodMs: 1000, enabled: false },
    });
  }
  if (
    physical.filter(
      (node) => (node.data as ModuleNodeData).driverTypeId === "declarative-device",
    ).length > 4
  )
    throw new Error(
      "Il Core supporta al massimo 4 istanze di driver e timer complessive.",
    );
  for (const node of sequences) {
    module(`driver-sequence:${node.id}`, {
      kind: "module",
      driverTypeId: "sequence",
      portId,
      bayId: 255,
      railId: 255,
      electricalMode: "input-output",
      properties: {},
    });
    generated.set(node.id, {
      ...node,
      data: { kind: "event-source", moduleNodeId: `driver-sequence:${node.id}` },
    });
  }
  // Module Function exposes digital inputs as potential canvas sources. A sensor
  // that owns a pin must not also acquire a generic edge watcher on that line.
  // Keep the project/palette intact; remove only unused automatic runtime nodes.
  for (let index = physical.length - 1; index >= 0; index--) {
    const node = physical[index]!;
    const data = node.data as ModuleNodeData;
    if (
      !node.id.startsWith("physical-pin:") ||
      data.driverTypeId !== "digital_input_trigger"
    )
      continue;
    if (!gpioOwners.has(`${data.portId}:${Number(data.properties["1"])}`)) continue;
    if (
      nodes.some(
        (item) =>
          item.data.kind !== "schedule" &&
          "moduleNodeId" in item.data &&
          item.data.moduleNodeId === node.id,
      )
    )
      throw new Error(
        "Un pin del dispositivo è usato anche da un ingresso GPIO nel canvas. Rimuovi l’ingresso duplicato o scegli un altro pin.",
      );
    physical.splice(index, 1);
  }
  const ids = physical
    .filter((node) => isModuleNodeData(node.data as ModuleNodeData))
    .map((node) => node.id)
    .sort();
  const keyOf = new Map(ids.map((id, index) => [id, index + 1]));
  const controlledModules = new Set<string>();
  for (const node of sequences) {
    const properties = (node.data as BlockNodeData).properties;
    const targets = new Set<string>();
    const program = encodeSequenceProgram(sequenceSteps(properties), (step) => {
      const target = runtime.get(sequenceActionNodeId(step.moduleId, step.actionId));
      if (!target) throw new Error("Sequenza: il modulo o l’azione non esistono più.");
      targets.add(step.moduleId);
      const metadata = stored.find((item) => item.id === step.moduleId);
      const draft = metadata?.recipe.deviceDraft;
      const action = draft?.commands.find((item) => item.id === step.actionId);
      const motion =
        action?.steps.some(
          (op) => op.type === "stepper" && op.command === "position",
        ) ?? false;
      if (motion && !step.waitForMotion)
        throw new Error(
          "Sequenza: attendi il movimento terminato prima del passo successivo.",
        );
      if (
        action &&
        draft &&
        effectiveActionSteps(draft, action).some((op) => op.type === "wait")
      )
        throw new Error(
          "Sequenza: sposta le attese dell’azione in un passo Attendi per mantenere Pausa e Stop reattivi.",
        );
      const args = Object.values(target.action.inputIds);
      const consumesInput =
        action?.steps.some(
          (op) => op.type === "stepper" && op.command === "position",
        ) ||
        (draft &&
          action &&
          effectiveActionSteps(draft, action).some(
            (op) => op.type === "gpio_write" && op.value?.kind === "variable",
          ));
      if (args.length > 1)
        throw new Error(
          "Sequenza: questa azione richiede più di un valore; usa un’azione con un solo ingresso dati.",
        );
      return {
        key: keyOf.get(target.moduleId)!,
        command: target.action.commandId,
        argument: consumesInput ? (args[0] ?? 0) : 0,
        motion,
      };
    });
    for (const target of targets) {
      if (controlledModules.has(target))
        throw new Error("Due sequenze non possono comandare lo stesso modulo.");
      if (
        edges.some((edge) => runtime.get(edge.target)?.moduleId === `driver:${target}`)
      )
        throw new Error(
          "Il modulo è comandato dalla Sequenza: rimuovi gli altri fili di comando per evitare movimenti in conflitto.",
        );
      controlledModules.add(target);
    }
    const index = physical.findIndex(
      (item) => item.id === `driver-sequence:${node.id}`,
    );
    const item = physical[index]!;
    physical[index] = {
      ...item,
      data: {
        ...(item.data as ModuleNodeData),
        properties: {
          ...Object.fromEntries(
            [0, 1, 2, 3].map((part) => [
              String(part + 1),
              [...program.slice(part * 16, part * 16 + 16)]
                .map((byte) => byte.toString(16).padStart(2, "0"))
                .join(""),
            ]),
          ),
          "5": properties.repeat === true,
          "6": properties.autostart === true,
          "7": stableDriverHash(node.id),
        },
      },
    };
  }
  const processing: Node[] = originalNodes
    .filter((node) => !aliases.has(node.id))
    .map((node) => generated.get(node.id) ?? node);
  for (const [id, node] of generated)
    if (!processing.some((item) => item.id === id) && !synthetic.has(id))
      processing.push(node);
  for (const node of sequences)
    processing.push({
      layer: "device-processing",
      id: `sequence-tick:${node.id}`,
      data: {
        kind: "schedule",
        moduleNodeId: `driver-sequence:${node.id}`,
        periodMs: 20,
        enabled: true,
      },
    });
  for (const [squareId, clocks] of squareWaveModules) {
    for (const extra of clocks.slice(1)) {
      const id = `driver-square:${squareId}:${extra.moduleId}`;
      if (!processing.some((node) => node.id === id))
        processing.push({
          layer: "device-processing",
          id,
          data: {
            kind: "schedule",
            moduleNodeId: extra.moduleId,
            periodMs: extra.periodMs,
            enabled: true,
          },
        });
    }
  }
  // Event-only sources must also be armed by a disabled runtime schedule.
  for (const node of [...processing]) {
    if (node.data.kind !== "event-source") continue;
    const moduleNodeId = node.data.moduleNodeId;
    const data = physical.find((item) => item.id === moduleNodeId)?.data as
      ModuleNodeData | undefined;
    if (
      data?.driverTypeId !== "on_boot" &&
      data?.driverTypeId !== "digital_input_trigger"
    )
      continue;
    if (
      !processing.some(
        (item) =>
          item.data.kind === "schedule" && item.data.moduleNodeId === moduleNodeId,
      )
    )
      processing.push({
        layer: "device-processing",
        id: `driver-events:${node.id}`,
        data: { kind: "schedule", moduleNodeId, periodMs: 1000, enabled: false },
      });
  }
  const byId = new Map(processing.map((node) => [node.id, node]));
  const compiledEdges: Edge[] = [];
  let nextDerivedKey = 0x70000000;
  const activitySources = new Map<
    string,
    { key: number; field: number; action?: number }
  >();
  function sourceFor(edge: Edge): { key: number; field: number; action?: number } {
    const cached = activitySources.get(edge.id);
    if (cached) return cached;
    const source = resolveActivitySource(edge);
    activitySources.set(edge.id, source);
    return source;
  }
  function resolveActivitySource(edge: Edge): {
    key: number;
    field: number;
    action?: number;
  } {
    const gpioObservation = viewerGpioSources.get(edge.id);
    if (gpioObservation) return { key: keyOf.get(gpioObservation.moduleId)!, field: gpioObservation.field };
    const node = byId.get(edge.source);
    if (!node) throw new Error(`Sorgente del filo «${edge.id}» non disponibile.`);
    const sequence = sequences.find((item) => item.id === node.id);
    if (sequence)
      return {
        key: keyOf.get(`driver-sequence:${node.id}`)!,
        field: edge.sourceHandle === "completed" ? 1 : 2,
      };
    const sensor = runtime.get(node.id);
    if (
      sensor &&
      edge.sourceHandle === MOVEMENT_COMPLETED &&
      !motionModules.has(sensor.moduleId)
    )
      throw new Error("Movimento terminato è disponibile soltanto per uno stepper.");
    if (sensor && edge.sourceHandle === MOVEMENT_COMPLETED)
      return { key: keyOf.get(sensor.moduleId)!, field: MOVEMENT_COMPLETED_FIELD };
    if (sensor) {
      const field = sensor.action.outputIds[edge.sourceHandle ?? ""];
      if (field === undefined)
        throw new Error(`Uscita «${edge.sourceHandle}» non disponibile nel sensore.`);
      return {
        key: keyOf.get(sensor.moduleId)!,
        field,
        ...(rgbTargets.has(node.id) ? {} : { action: sensor.action.commandId }),
      };
    }
    if (node.data.kind === "event-source" || node.data.kind === "schedule") {
      const key = keyOf.get(node.data.moduleNodeId);
      if (!key) throw new Error(`Trigger «${node.id}» senza modulo fisico.`);
      const moduleNodeId = node.data.moduleNodeId;
      const moduleData = physical.find((item) => item.id === moduleNodeId)?.data as
        ModuleNodeData | undefined;
      return {
        key,
        field:
          node.data.kind === "schedule" ||
          manualTriggers.some((item) => item.id === node.id) ||
          moduleData?.driverTypeId === "digital_input_trigger"
            ? 1
            : Number(edge.sourceHandle ?? 0),
      };
    }
    if (node.data.kind !== "block")
      throw new Error("Una regola non può alimentare un’azione.");
    const bridgeId = `driver-publish:${edge.id}`;
    const key = nextDerivedKey++;
    processing.push({
      layer: "device-processing",
      id: bridgeId,
      data: {
        kind: "block",
        blockTypeId: "publish_field",
        properties: {
          "1": `flow.${stableDriverHash(edge.id)}`,
          "2": 1n,
          "3": 1n,
          "4": BigInt(key),
        },
      },
    });
    compiledEdges.push({ ...edge, target: bridgeId, targetHandle: "0" });
    return { key, field: 1 };
  }
  for (const edge of [...edges].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    const sequenceTarget = sequences.find((node) => node.id === edge.target);
    const sequenceCommand = { start: 1, pause: 2, stop: 3 }[edge.targetHandle ?? ""];
    if (sequenceTarget && !sequenceCommand)
      throw new Error("Sequenza: ingresso sconosciuto.");
    const target = sequenceTarget
      ? {
          moduleId: `driver-sequence:${edge.target}`,
          action: { commandId: sequenceCommand!, inputIds: {}, outputIds: {} },
          triggerHandle: edge.targetHandle,
        }
      : runtime.get(edge.target);
    if (!target) {
      compiledEdges.push(edge);
      continue;
    }
    const originalSource = nodes.find((node) => node.id === edge.source);
    if (
      originalSource &&
      isSquareWaveNode(originalSource.data) &&
      squareDriven.has(edge.target)
    )
      continue;
    const source = sourceFor(edge);
    const rgb = rgbTargets.get(edge.target);
    if (rgb) {
      const input = rgbInputCommand(rgb, edge.targetHandle ?? "");
      if (
        input.mode !== 1 &&
        edges.filter(
          (item) =>
            item.target === edge.target && item.targetHandle === edge.targetHandle,
        ).length > 1
      )
        throw new Error("Collega una sola sorgente a ciascun ingresso RGB.");
      processing.push({
        layer: "device-processing",
        id: `rgb-input:${edge.id}`,
        data: {
          kind: "rule",
          ruleTypeId: "device-action",
          properties: {
            "1": BigInt(source.key),
            "3": BigInt(keyOf.get(target.moduleId)!),
            "4": BigInt(input.commandId),
            "5": BigInt(source.field),
            ...(source.action ? { "2": BigInt(source.action) } : {}),
            ...(input.argument ? { "6": BigInt(input.argument) } : {}),
            "8": BigInt(
              input.mode === 1 && (originalSource?.data.kind === "schedule" || (originalSource?.data.kind === "block" && originalSource.data.blockTypeId === "logic_while"))
                ? 0
                : input.mode,
            ),
          },
        },
      });
      continue;
    }
    const targetSensorNode = sensorNodes.find((item) => item.id === edge.target);
    const targetSensor =
      targetSensorNode &&
      stored.find(
        (item) => item.id === targetSensorNode.data.properties[SENSOR_MODULE_ID_PROP],
      );
    if (
      targetSensor?.recipe.deviceDraft?.dht22Module &&
      ["read-trigger", "execute"].includes(edge.targetHandle ?? "")
    ) {
      if (!source.field)
        throw new Error("DHT22: collega al trigger un segnale digitale o booleano.");
      processing.push({
        layer: "device-processing",
        id: `dht22-trigger:${edge.id}`,
        data: {
          kind: "rule",
          ruleTypeId: "device-action",
          properties: {
            "1": BigInt(source.key),
            "3": BigInt(keyOf.get(target.moduleId)!),
            "4": BigInt(target.action.commandId),
            "5": BigInt(source.field),
            "8": originalSource?.data.kind === "schedule" || (originalSource?.data.kind === "block" && originalSource.data.blockTypeId === "logic_while") ? 0n : 1n,
            ...(source.action ? { "2": BigInt(source.action) } : {}),
          },
        },
      });
      continue;
    }
    const execute =
      edge.targetHandle === "execute" ||
      Boolean(target.triggerHandle && edge.targetHandle === target.triggerHandle);
    const explicit = edges.some(
      (other) =>
        other.target === edge.target &&
        (other.targetHandle === "execute" ||
          Boolean(target.triggerHandle && other.targetHandle === target.triggerHandle)),
    );
    const argument = execute
      ? undefined
      : target.action.inputIds[edge.targetHandle ?? ""];
    if (!execute && !argument)
      throw new Error(`Parametro «${edge.targetHandle}» sconosciuto.`);
    const sourceNode = byId.get(edge.source)!;
    processing.push({
      layer: "device-processing",
      id: `${execute ? "1-execute" : "0-parameter"}:${edge.id}`,
      data: {
        kind: "rule",
        ruleTypeId: "device-action",
        properties: {
          "1": BigInt(source.key),
          "3": BigInt(keyOf.get(target.moduleId)!),
          "4": BigInt(target.action.commandId),
          ...(source.action ? { "2": BigInt(source.action) } : {}),
          ...(source.field ? { "5": BigInt(source.field) } : {}),
          ...(argument
            ? { "6": BigInt(argument), ...(source.field ? {} : { "7": 1n }) }
            : {}),
          "8": BigInt(
            execute
              ? (sourceNode.data.kind === "block" && sourceNode.data.blockTypeId !== "logic_while") ||
                manualTriggers.some((node) => node.id === edge.source)
                ? 1
                : 0
              : explicit ||
                  sensorNodes.some(
                    (node) =>
                      node.id === edge.target &&
                      node.data.properties[SENSOR_INSTANCE_PROP] === true,
                  )
                ? 3
                : 4,
          ),
        },
      },
    });
  }
  const observations = [...viewerEdges]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((edge) => {
      const source = sourceFor(edge);
      const moduleId = [...keyOf].find(([, key]) => key === source.key)?.[0];
      const moduleData = physical.find((node) => node.id === moduleId)?.data as
        ModuleNodeData | undefined;
      const profile = profiles.find((item) => item.profileId === moduleData?.profileId);
      return {
        viewerId: edge.target,
        ...viewerPresentation.get(edge.id),
        ...source,
        schemaId:
          profile?.sampleSchemaId ??
          (moduleId ? undefined : `flow.${stableDriverHash(edge.id)}`),
      };
    });
  // Reuse module records; publish native logic outputs so their wires can
  // animate too, including LOW/zero values, without polling hardware.
  for (const edge of edges) {
    if (activitySources.has(edge.id)) continue;
    const node = byId.get(edge.source);
    if (
      node &&
      (runtime.has(node.id) ||
        sequences.some((item) => item.id === node.id) ||
        node.data.kind === "schedule" ||
        node.data.kind === "event-source" ||
        (node.data.kind === "block" && (LOGIC_TYPES.has(node.data.blockTypeId) || node.data.blockTypeId === "status_led")))
    ) {
      try {
        sourceFor(edge);
      } catch {
        /* Unobserved legacy output: no animation. */
      }
    }
  }
  const activityRoutes: EdgeActivityRoute[] = [...edges, ...viewerEdges].flatMap(
    (edge) => {
      const source = activitySources.get(edge.id);
      if (!source) return [];
      const moduleId = [...keyOf].find(([, key]) => key === source.key)?.[0];
      const moduleData = physical.find((node) => node.id === moduleId)?.data as
        ModuleNodeData | undefined;
      const profile = profiles.find((item) => item.profileId === moduleData?.profileId);
      const original = originalNodes.find((node) => node.id === edge.source);
      return [
        {
          ...source,
          edgeId: edge.id.replace(/:scheduled$/, ""),
          schemaId:
            profile?.sampleSchemaId ??
            (moduleId ? undefined : `flow.${stableDriverHash(edge.id)}`),
          kind:
            original?.data.kind === "schedule" ||
            manualTriggers.some((node) => node.id === edge.source)
              ? ("trigger" as const)
              : ("data" as const),
        },
      ];
    },
  );
  const signalObservations = edges.flatMap(edge => {
    const observed = viewerGpioSources.get(`signal-preview:${edge.id}`);
    if (!observed) return [];
    const data = physical.find(node => node.id === observed.moduleId)?.data as ModuleNodeData | undefined;
    const profile = profiles.find(profile => profile.profileId === data?.profileId);
    return [{ generatorId: edge.source, key: keyOf.get(observed.moduleId)!, field: observed.field, schemaId: profile?.sampleSchemaId }];
  });
  const outputField = ({
    node,
    handle,
  }: {
    node: Node;
    handle: string | undefined;
  }): number | undefined => {
    const sensor = runtime.get(node.id);
    if (sensor && handle === MOVEMENT_COMPLETED) return MOVEMENT_COMPLETED_FIELD;
    if (sensor) return sensor.action.outputIds[handle ?? ""];
    if (sequences.some((item) => item.id === node.id))
      return handle === "completed" ? 1 : 2;
    if (node.data.kind === "schedule" || manualTriggers.some(trigger => trigger.id === node.id)) return 1;
    return numericPort(node, handle, "outputs");
  };
  return {
    profiles,
    observations,
    signalObservations,
    activityRoutes,
    input: {
      ...input,
      physicalGraph: { ...input.physicalGraph, nodes: physical },
      processingGraph: {
        ...input.processingGraph,
        nodes: processing,
        edges: compiledEdges,
      },
    },
    options: {
      resolveSourcePortOrField: outputField,
      resolveTargetInput: ({ node, handle }) => numericPort(node, handle, "inputs"),
      maxModules: 8,
      maxSchedules: 8,
      maxRules: 4,
      maxBlocks: 16,
      maxEdges: 24,
    },
  };
}
function numericPort(
  node: Node,
  handle: string | undefined,
  direction: "inputs" | "outputs",
): number | undefined {
  if (handle !== undefined && /^\d+$/.test(handle)) return Number(handle);
  if (node.data.kind !== "block") return undefined;
  const entry =
    (node.data.catalogEntryId
      ? findCatalogEntryById(node.data.catalogEntryId)
      : undefined) ?? findCatalogEntriesByTypeId(node.data.blockTypeId)[0];
  const ports = entry?.[direction];
  const index = ports?.findIndex((port) => port.id === handle);
  return index !== undefined && index >= 0 ? index : undefined;
}
