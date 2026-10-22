import { lowerRgbLedPresets } from "./rgb-led-presets.js";
import { activeModuleIds } from "./active-module-ids.js";
import { resolveLogicalBackbones } from "./logical-backbone-slots.js";
import type {
  GetStatusResponse,
  ApplyPhysicalRequest,
} from "@spaghettilab/protocol-sdk";
import type { ProjectV1 } from "@spaghettilab/domain";
import type { CompileConfigInput } from "@spaghettilab/config-compiler";
import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import type { GraphNode } from "@spaghettilab/domain";
import {
  prepareDriverDeployment,
  type DriverDeploymentPlan,
} from "./driver-deployment-plan.js";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  modulesForBinding,
  parseBackboneSensorModules,
} from "./backbone-sensor-modules.js";
import { PHYSICAL_META_KEY, parsePhysicalProject } from "./backbone-physical.js";
import { SENSOR_MODULE_ID_PROP } from "./backbone-sensor-block.js";
import { SENSOR_OUTPUT_PROP } from "./sensor-instance.js";
import { sequenceSteps, SEQUENCE_TYPE } from "./flow-sequence.js";
import {
  findCatalogEntryById,
  findCatalogEntriesByTypeId,
} from "@spaghettilab/processing-block-catalog";
import { stableDriverHash } from "./driver-runtime-profile.js";

type Node = GraphNode<"device-processing", string, DeviceProcessingNodeData>;
export type DistributedDeploymentPlan = DriverDeploymentPlan & {
  readonly remotePlans: readonly {
    nodeId: number;
    label: string;
    plan: DriverDeploymentPlan;
  }[];
  readonly hostNodeId?: number;
  readonly physicalRequests?: readonly ApplyPhysicalRequest[];
};
/** Physical ownership is independent from which board currently provides USB. */
export function prepareDistributedDeployment(
  project: ProjectV1,
  bindingId: string,
  input: CompileConfigInput,
  status?: GetStatusResponse,
): DistributedDeploymentPlan {
  input = { ...input, processingGraph: lowerRgbLedPresets(input.processingGraph) };
  const resolved = status
    ? resolveLogicalBackbones(project, bindingId, status)
    : undefined;
  if (resolved) project = resolved.project;
  const physical = parsePhysicalProject(
    project.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  );
  const drafts = Object.entries(physical.drafts).filter(([key]) =>
    key.startsWith(`${bindingId}:`),
  );
  const stored = parseBackboneSensorModules(
    project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
  );
  const active = activeModuleIds(input.processingGraph.nodes);
  const modules = modulesForBinding(stored, bindingId).filter((module) =>
    active.has(module.id),
  );
  const binding = project.coreBindings.find((item) => item.bindingId === bindingId);
  const identity = binding?.expectedDeviceId?.replace(/[^0-9a-f]/gi, "");
  const hostNodeId =
    (identity && identity.length >= 12
      ? Number.parseInt(identity.slice(6, 12), 16)
      : undefined) ??
    drafts.find(([, draft]) => draft.local !== false && draft.nodeId)?.[1].nodeId;
  const boardOf = (draft: (typeof drafts)[number][1] | undefined): number =>
    draft?.nodeId && hostNodeId
      ? draft.nodeId === hostNodeId
        ? 0
        : draft.nodeId
      : draft?.local === false
        ? (draft.nodeId ?? 0)
        : 0;
  let installations: Record<string, { moduleId?: string; boardKey?: string }> = {};
  try {
    installations = JSON.parse(
      project.authoringMetadata.__nfcInstallations?.comment ?? "{}",
    );
  } catch {
    /* no installations */
  }
  const moduleBoard = new Map(
    modules.map((module) => {
      const key =
        module.gpioAssignments?.boardKey ??
        module.gpioAssignment?.boardKey ??
        Object.values(installations).find((item) => item.moduleId === module.id)
          ?.boardKey;
      const draft = key ? physical.drafts[key] : undefined;
      if (key && !draft)
        throw new Error(`${module.label}: la Backbone assegnata non è disponibile.`);
      if (draft?.local === false && !draft.nodeId)
        throw new Error(`${module.label}: identità CAN della Backbone mancante.`);
      return [module.id, boardOf(draft)] as const;
    }),
  );
  const nodes = input.processingGraph.nodes as readonly Node[];
  const placement = new Map<string, number>();
  for (const node of nodes) {
    const props = "properties" in node.data ? node.data.properties : undefined;
    const moduleId = String(props?.[SENSOR_MODULE_ID_PROP] ?? "");
    const reference = String(
      props?.physicalPinId ??
        (node.data.kind === "event-source"
          ? node.data.moduleNodeId.replace(/^physical-pin:/, "")
          : ""),
    );
    const boardKey =
      typeof props?.boardKey === "string"
        ? props.boardKey
        : drafts.find(([key]) => reference.startsWith(`${key}:`))?.[0];
    const board = boardKey ? physical.drafts[boardKey] : undefined;
    placement.set(node.id, moduleBoard.get(moduleId) ?? boardOf(board));
  }
  for (const node of nodes)
    if (node.data.kind === "block" && node.data.blockTypeId === SEQUENCE_TYPE) {
      const targets = new Set(
        sequenceSteps(node.data.properties).flatMap((step) =>
          step.kind === "action" ? [moduleBoard.get(step.moduleId) ?? 0] : [],
        ),
      );
      if (targets.size > 1)
        throw new Error(
          "Sequenza: assegna le azioni della stessa sequenza a una sola Backbone.",
        );
      if (targets.size) placement.set(node.id, [...targets][0]!);
    }
  const boards = [...new Set([0, ...placement.values()])].sort((a, b) => a - b);
  if (boards.length === 1) {
    const normalized = {
      ...project,
      authoringMetadata: {
        ...project.authoringMetadata,
        [PHYSICAL_META_KEY]: {
          ...project.authoringMetadata[PHYSICAL_META_KEY],
          comment: JSON.stringify({
            ...physical,
            drafts: Object.fromEntries(
              Object.entries(physical.drafts).map(([key, draft]) => [
                key,
                { ...draft, local: boardOf(draft) === 0 },
              ]),
            ),
          }),
        },
      },
    };
    return {
      ...prepareDriverDeployment(normalized, bindingId, input),
      physicalRequests: resolved?.requests,
      remotePlans: [],
      hostNodeId,
    };
  }
  if (!hostNodeId)
    throw new Error(
      "Ricollega la Backbone USB per identificarla prima del caricamento distribuito.",
    );
  // A cycle must not become invisible merely because it crosses a CAN boundary.
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id))
      throw new Error("Il programma contiene un ciclo tra i collegamenti.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of input.processingGraph.edges.filter((e) => e.source === id))
      visit(edge.target);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.id);
  const perBoard = new Map(
    boards.map((board) => [
      board,
      {
        nodes: nodes.filter((node) => placement.get(node.id) === board) as Node[],
        edges: input.processingGraph.edges.filter(
          (edge) =>
            placement.get(edge.source) === board &&
            placement.get(edge.target) === board,
        ),
        physical: input.physicalGraph.nodes.filter((node) => {
          const data = node.data as { properties?: Record<string, unknown> };
          const key = data.properties?.boardKey;
          const nativeKey = drafts.find(([key]) =>
            node.id.startsWith(`physical-pin:${key}:`),
          )?.[0];
          const draft =
            typeof key === "string"
              ? physical.drafts[key]
              : nativeKey
                ? physical.drafts[nativeKey]
                : undefined;
          return boardOf(draft) === board;
        }),
      },
    ]),
  );
  const routes = new Set<number>();
  for (const edge of [...input.processingGraph.edges].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const from = placement.get(edge.source),
      to = placement.get(edge.target);
    if (from === undefined || to === undefined)
      throw new Error("Un collegamento punta a un blocco mancante.");
    if (from === to) continue;
    const route = Number.parseInt(stableDriverHash(edge.id).slice(0, 4), 16) || 1;
    if (routes.has(route))
      throw new Error(
        "Due collegamenti CAN hanno la stessa identità: ricrea uno dei fili.",
      );
    routes.add(route);
    const sender = perBoard.get(from)!,
      receiver = perBoard.get(to)!;
    const tx = `can-tx:${edge.id}`,
      rx = `can-rx:${edge.id}`;
    const native = (id: string, peer: number) => ({
      layer: "physical-composition" as const,
      id,
      data: {
        kind: "module" as const,
        driverTypeId: "can-link",
        portId: 0,
        bayId: 255,
        railId: 255,
        electricalMode: "input-output" as const,
        properties: { "1": BigInt(peer), "2": BigInt(route) },
      },
    });
    sender.physical.push(native(tx, to || hostNodeId));
    receiver.physical.push(native(rx, from || hostNodeId));
    sender.nodes.push({
      layer: "device-processing",
      id: tx,
      data: {
        kind: "block",
        blockTypeId: "app.can_send",
        properties: { moduleNodeId: tx },
      },
    });
    const source = nodes.find((node) => node.id === edge.source)!;
    let presentation: Record<string, unknown> | undefined;
    let dataType = "digital";
    if (source.data.kind === "block") {
      const properties = source.data.properties;
      const module = modules.find(
        (module) => module.id === properties[SENSOR_MODULE_ID_PROP],
      );
      const channel = module?.recipe.deviceDraft?.channels.find(
        (channel) =>
          channel.id === (edge.sourceHandle ?? properties[SENSOR_OUTPUT_PROP]),
      );
      if (channel)
        dataType =
          channel.quantity === "digital" ? "digital" : (channel.dataType ?? "int");
      else if (source.data.blockTypeId === "led_driver")
        dataType = edge.sourceHandle === "0" ? "string" : "int";
      else if (!source.data.blockTypeId.startsWith("logic_")) {
        const entry =
          findCatalogEntryById(source.data.catalogEntryId ?? "") ??
          findCatalogEntriesByTypeId(source.data.blockTypeId)[0];
        const output = entry?.outputs?.find(
          (port) => port.id === (edge.sourceHandle ?? "0"),
        );
        if (output?.types.every((type) => ["analog", "quantity"].includes(type.domain)))
          dataType = "number";
        else if (output?.types.every((type) => type.domain === "text"))
          dataType = "string";
      }
      if (channel)
        presentation = {
          label: channel.label,
          unit: channel.unit ?? "",
          colorKind:
            channel.colorKind ??
            (module?.recipe.deviceDraft?.rgbModule && channel.id === "color"
              ? "rgb"
              : undefined),
          valueKind:
            channel.dataType === "bool"
              ? "boolean"
              : channel.quantity === "digital"
                ? "digital"
                : channel.dataType === "string"
                  ? "text"
                  : "number",
        };
    }
    receiver.nodes.push({
      layer: "device-processing",
      id: rx,
      data: {
        kind: "event-source",
        moduleNodeId: rx,
        properties: {
          canSourceKind: source.data.kind,
          ...(source.data.kind === "block"
            ? { canSourceBlockType: source.data.blockTypeId }
            : {}),
          canDataType: dataType,
          ...(presentation ? { canPresentation: JSON.stringify(presentation) } : {}),
        },
      },
    });
    sender.edges.push({ ...edge, target: tx, targetHandle: "0" });
    receiver.edges.push({ ...edge, source: rx, sourceHandle: "1" });
  }
  const compiled = new Map<number, DriverDeploymentPlan>();
  for (const [board, part] of perBoard) {
    const boardModules = modules.filter(
      (module) => (moduleBoard.get(module.id) ?? 0) === board,
    );
    const boardDrafts = Object.fromEntries(
      drafts
        .filter(([, draft]) => boardOf(draft) === board)
        .map(([key, draft]) => [key, { ...draft, local: true }]),
    );
    const metadata = {
      ...project.authoringMetadata,
      [BACKBONE_SENSOR_MODULES_META_KEY]: {
        ...project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY],
        comment: JSON.stringify({
          ...stored,
          byBinding: { ...stored.byBinding, [bindingId]: boardModules },
        }),
      },
      [PHYSICAL_META_KEY]: {
        ...project.authoringMetadata[PHYSICAL_META_KEY],
        comment: JSON.stringify({ ...physical, drafts: boardDrafts }),
      },
    };
    const ids = new Set(part.physical.map((node) => node.id));
    const plan = prepareDriverDeployment(
      { ...project, authoringMetadata: metadata },
      bindingId,
      {
        ...input,
        physicalGraph: {
          ...input.physicalGraph,
          nodes: part.physical,
          edges: input.physicalGraph.edges.filter(
            (edge) => ids.has(edge.source) && ids.has(edge.target),
          ),
        },
        processingGraph: {
          ...input.processingGraph,
          nodes: part.nodes,
          edges: part.edges,
        },
      },
    );
    compiled.set(board, plan);
  }
  return {
    ...compiled.get(0)!,
    hostNodeId,
    physicalRequests: resolved?.requests,
    remotePlans: boards
      .filter((board) => board !== 0)
      .map((nodeId) => ({
        nodeId,
        label: status
          ? `Backbone ${(status.chainPeers?.filter((peer) => !peer.local && (peer.flags & 0x02) === 0).findIndex((peer) => peer.nodeId === nodeId) ?? -1) + 2}`
          : `Backbone CAN · ${nodeId.toString(16).toUpperCase()}`,
        plan: compiled.get(nodeId)!,
      })),
  };
}
