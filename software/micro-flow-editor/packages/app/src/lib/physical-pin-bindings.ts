import type { ProjectV1, GraphNode } from "@spaghettilab/domain";
import type { ModuleNodeData } from "@spaghettilab/physical-composition-model";
import {
  PHYSICAL_META_KEY,
  parsePhysicalProject,
  type BackbonePhysicalDraft,
} from "./backbone-physical.js";

export type PhysicalPinBinding = {
  readonly id: string;
  readonly local: boolean;
  readonly backendPortId: number;
  readonly channel: number;
  readonly pin: number;
  readonly entryId: string;
  readonly moduleNodeId: string;
  readonly name: string;
};
export function physicalPinsForBinding(
  project: ProjectV1 | undefined,
  bindingId: string | undefined,
): PhysicalPinBinding[] {
  if (!project || !bindingId) return [];
  const saved = parsePhysicalProject(
    project.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  );
  return Object.entries(saved.drafts)
    .filter(([key, draft]) => key.startsWith(`${bindingId}:`) && draft.applied)
    .flatMap(([key, draft]) =>
      draft.modes.flatMap((mode, channel) => {
        const entryId = (
          {
            1: "native.physical_gpio_input",
            2: "native.physical_gpio_out",
            3: "native.physical_gpio_out",
            6: "native.physical_uart_tx",
            7: "native.physical_uart_rx",
            8: "native.physical_spi",
            12: "native.physical_pwm_out",
          } as Record<number, string>
        )[mode & 15];
        if (!entryId) return [];
        const id = `${key}:${channel}`;
        return [
          {
            id,
            local: draft.local === true,
            backendPortId: draft.backendPortId ?? 0,
            channel,
            pin: channel + 2,
            entryId,
            moduleNodeId: `physical-pin:${id}`,
            name: draft.name || "Function · porta 2",
          },
        ];
      }),
    );
}

export function addConfirmedPinModules(
  project: ProjectV1,
  bindingId: string,
  boardKey: string,
  draft: BackbonePhysicalDraft,
  legacyBoardKeys: readonly string[] = [],
): ProjectV1 {
  if (!draft.local) return project;
  const index = project.coreBindings.findIndex(
    (binding) => binding.bindingId === bindingId,
  );
  if (index < 0) return project;
  const graph = project.physicalGraphs[index] ?? {
    layer: "physical-composition" as const,
    nodes: [],
    edges: [],
  };
  const prefix = `physical-pin:${boardKey}:`;
  const retiredPrefixes = [prefix, ...legacyBoardKeys.map((key) => `physical-pin:${key}:`)];
  const nodes = graph.nodes.filter(
    (node) => !retiredPrefixes.some((retired) => node.id.startsWith(retired)),
  );
  draft.modes.forEach((mode, channel) => {
    if ((mode & 15) !== 1) return;
    const node: GraphNode<"physical-composition", string, ModuleNodeData> = {
      layer: "physical-composition",
      id: `${prefix}${channel}`,
      data: {
        kind: "module",
        driverTypeId: "digital_input_trigger",
        portId: draft.backendPortId ?? 0,
        bayId: 0,
        railId: 0,
        electricalMode: "input-only",
        properties: { "1": BigInt(channel), "2": true, "3": true },
      },
    };
    nodes.push(node);
  });
  const ids = new Set(nodes.map((node) => node.id));
  const physicalGraphs = [...project.physicalGraphs];
  physicalGraphs[index] = {
    ...graph,
    nodes,
    edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
  return { ...project, physicalGraphs };
}
