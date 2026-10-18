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
import {
  PortCapability,
  PortTransport,
} from "@spaghettilab/device-profile-authoring-model";
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
import { isMappedTrigger, mappedTriggerActionSteps } from "./gpio-trigger-map.js";

const SQUARE_WAVE_IDS = new Set(["appblocks.square_wave", "ab.square_wave"]);

function isSquareWaveNode(data: DeviceProcessingNodeData): boolean {
  if (data.kind !== "block") return false;
  return SQUARE_WAVE_IDS.has(data.catalogEntryId ?? "") || SQUARE_WAVE_IDS.has(data.blockTypeId);
}

function numberFromUnknown(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function squareWavePeriodMs(properties: Readonly<Record<string, unknown>>): number {
  return Math.max(20, Math.min(60_000, numberFromUnknown(properties.periodMs, 500)));
}

function squareWavePulseMs(properties: Readonly<Record<string, unknown>>): number {
  const period = squareWavePeriodMs(properties);
  const duty = Math.max(1, Math.min(99, numberFromUnknown(properties.dutyCycle, 50)));
  return Math.max(1, Math.min(period - 1, Math.round((period * duty) / 100)));
}

function squareWavePulseSteps(nodeId: string, signalId: string, pulseMs: number): readonly DeviceRecipeOp[] {
  return [
    { id: `${nodeId}-sq-high`, type: "gpio_write", signalId, level: 1 },
    { id: `${nodeId}-sq-wait`, type: "wait", ms: pulseMs },
    { id: `${nodeId}-sq-low`, type: "gpio_write", signalId, level: 0 },
  ];
}

type Node = GraphNode<"device-processing", string, DeviceProcessingNodeData>;
type Edge = CompileConfigInput["processingGraph"]["edges"][number];
export type DriverDeploymentPlan = {
  input: CompileConfigInput;
  profiles: readonly DeviceProfileDraft[];
  options: CompileConfigOptions;
};
export function prepareDriverDeployment(
  project: ProjectV1,
  bindingId: string,
  input: CompileConfigInput,
): DriverDeploymentPlan {
  const nodes = input.processingGraph.nodes as readonly Node[];
  const sensorNodes = nodes.filter(
    (node): node is Node & { data: BlockNodeData } =>
      node.data.kind === "block" &&
      node.data.blockTypeId === BACKBONE_SENSOR_BLOCK_TYPE_ID,
  );
  if (!sensorNodes.length) return { input, profiles: [], options: {} };
  const stored = modulesForBinding(
    parseBackboneSensorModules(
      project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
    ),
    bindingId,
  );
  const applied = Object.entries(
    parsePhysicalProject(project.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts,
  ).filter(([key, value]) => key.startsWith(`${bindingId}:`) && value.applied);
  const portId = applied[0]?.[1].backendPortId ?? 0;
  const physical = [...input.physicalGraph.nodes];
  const profiles: DeviceProfileDraft[] = [];
  const runtime = new Map<
    string,
    { moduleId: string; action: RuntimeAction; triggerHandle?: string }
  >();
  const generated = new Map<string, Node>();
  const squareDriven = new Set<string>();
  const squareWaveModules = new Map<
    string,
    { moduleId: string; periodMs: number }[]
  >();
  const gpioOwners = new Set<string>();
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
  const edges = originalEdges
    .filter((edge) => !aliases.has(edge.target))
    .map((edge) => ({ ...edge, source: resolveAlias(edge.source) }));
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
              (!metadata?.gpioAssignment || channel === metadata.gpioAssignment.channel)
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
          "Applica una porta I²C univoca (SDA e SCL) nel Module Function prima di Run Deploy.",
        );
      driverPortId = ports[0]!;
    }
    const instances = sensorNodes
      .filter((node) => node.data.properties[SENSOR_MODULE_ID_PROP] === groupId)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
        (step) =>
          step.fromChannelId === selectedInput && step.inputMode === "trigger",
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
      const squareSource = incoming
        .map((edge) => nodes.find((item) => item.id === edge.source))
        .find((source) => source && isSquareWaveNode(source.data));
      if (squareSource && draft.binding.bus === "gpio") {
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
        if (incoming.filter((edge) => edge.targetHandle === id).length > 1)
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
    const compiled = compileRuntimeDriver(driverDraft, connected, gpioChannels);
    profiles.push(compiled.profile);
    const moduleId = `driver:${groupId}`;
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
        ...(isTrigger || squareDriven.has(node.id) ? { triggerHandle: selectedInput || "comando" } : {}),
      });
      generated.set(node.id, {
        ...node,
        data: { kind: "event-source", moduleNodeId: moduleId },
      });
    }
  }
  let clockAddress = 1;
  for (const node of nodes) {
    const gpioClocks = squareWaveModules.get(node.id);
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
      const periodMs = isSquareWaveNode(node.data) && isBlockNodeData(node.data)
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
        transport: PortTransport.I2C,
        requiredCapabilities: PortCapability.I2C,
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
        endpoint: { address: clockAddress },
        electricalMode: "input-only",
        properties: { "1": profile.profileId, "2": 1n, "4": BigInt(clockAddress++) },
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
  if (
    physical.filter(
      (node) => (node.data as ModuleNodeData).driverTypeId === "declarative-device",
    ).length > 4
  )
    throw new Error(
      "Il Core supporta al massimo 4 istanze di driver e timer complessive.",
    );
  const ids = physical
    .filter((node) => isModuleNodeData(node.data as ModuleNodeData))
    .map((node) => node.id)
    .sort();
  const keyOf = new Map(ids.map((id, index) => [id, index + 1]));
  const processing: Node[] = nodes
    .filter((node) => !aliases.has(node.id))
    .map((node) => generated.get(node.id) ?? node);
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
  function sourceFor(edge: Edge): { key: number; field: number; action?: number } {
    const node = byId.get(edge.source);
    if (!node) throw new Error(`Sorgente del filo «${edge.id}» non disponibile.`);
    const sensor = runtime.get(node.id);
    if (sensor) {
      const field = sensor.action.outputIds[edge.sourceHandle ?? ""];
      if (field === undefined)
        throw new Error(`Uscita «${edge.sourceHandle}» non disponibile nel sensore.`);
      return {
        key: keyOf.get(sensor.moduleId)!,
        field,
        action: sensor.action.commandId,
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
    const target = runtime.get(edge.target);
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
              ? sourceNode.data.kind === "block"
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
  const outputField = ({
    node,
    handle,
  }: {
    node: Node;
    handle: string | undefined;
  }): number | undefined => {
    const sensor = runtime.get(node.id);
    if (sensor) return sensor.action.outputIds[handle ?? ""];
    if (node.data.kind === "schedule") return 1;
    return numericPort(node, handle, "outputs");
  };
  return {
    profiles,
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
