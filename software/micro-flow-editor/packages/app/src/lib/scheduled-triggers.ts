import type { GraphState } from "@spaghettilab/domain";
import type {
  DeviceProcessingNodeData,
  ScheduleNodeData,
} from "@spaghettilab/device-processing-graph-model";
/** Explicit container membership, possibly through the fixed Schedule plug. */
export function scheduleForTrigger(
  graph: GraphState<"device-processing">,
  id: string,
): { id: string; data: ScheduleNodeData } | undefined {
  const byId = new Map(
    graph.nodes.map((node) => [node.id, node.data as DeviceProcessingNodeData]),
  );
  const pending = graph.edges
    .filter((edge) => edge.target === id)
    .map((edge) => edge.source);
  const seen = new Set<string>();
  const schedules = new Map<string, ScheduleNodeData>();
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const data = byId.get(current);
    if (data?.kind === "schedule") schedules.set(current, data);
    else if (data?.kind === "block" && data.blockTypeId === "ab.flow_start")
      pending.push(
        ...graph.edges
          .filter((edge) => edge.target === current)
          .map((edge) => edge.source),
      );
  }
  if (schedules.size > 1)
    throw new Error("Genera trigger: inseriscilo in un solo Schedule.");
  const match = schedules.entries().next().value;
  return match ? { id: match[0], data: match[1] } : undefined;
}
