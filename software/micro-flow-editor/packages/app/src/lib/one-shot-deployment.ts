import type { CompileConfigInput } from "@spaghettilab/config-compiler";

/** Disable user clocks before APPLY_CONFIG, keeping asynchronous action completion alive. */
export function oneShotDeploymentInput(
  input: CompileConfigInput,
  completionProfiles: readonly string[],
): CompileConfigInput {
  const completionModules = new Set(input.physicalGraph.nodes.filter(node => {
    const data = node.data as { properties?: Record<string, unknown> };
    return completionProfiles.includes(String(data.properties?.["1"]));
  }).map(node => node.id));
  return {
    ...input,
    physicalGraph: { ...input.physicalGraph, nodes: input.physicalGraph.nodes.map(node => {
      const data = node.data as { kind?: string; driverTypeId?: string; properties?: Record<string, unknown> };
      return data.driverTypeId === "sequence" ? { ...node, data: { ...data, properties: { ...data.properties, "6": false } } } : node;
    }) },
    processingGraph: { ...input.processingGraph, nodes: input.processingGraph.nodes.map(node => {
      const data = node.data as { kind?: string; moduleNodeId?: string };
      return data.kind === "schedule" ? { ...node, data: { ...data, enabled: completionModules.has(data.moduleNodeId ?? "") } } : node;
    }) },
  };
}
