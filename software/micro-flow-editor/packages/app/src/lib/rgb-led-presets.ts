import { isBlockNodeData, type DeviceProcessingNodeData, type BlockNodeData } from "@spaghettilab/device-processing-graph-model";
import type { CompileConfigInput } from "@spaghettilab/config-compiler";
import type { ProjectV1 } from "@spaghettilab/domain";
import { defaultLedDriver, readLedDriver, type LedDriverConfig } from "./led-driver.js";
export const RGB_PRESET_PREFIX = "preset:";
export function isRgbLed(properties: Readonly<Record<string, unknown>>): boolean {
  return typeof properties.sensorRgbInputFamilies === "string";
}
export function rgbLedPresets(properties: Readonly<Record<string, unknown>>): LedDriverConfig {
  return typeof properties.rgbLedPresets === "string"
    ? readLedDriver({ ledDriverConfig: properties.rgbLedPresets }) : defaultLedDriver();
}
/** Preset logic is compiled internally; no extra block is needed on the canvas. */
export function lowerRgbLedPresets(graph: CompileConfigInput["processingGraph"]): CompileConfigInput["processingGraph"] {
  const nodes = [...graph.nodes];
  let edges = [...graph.edges];
  for (const node of graph.nodes) {
    if (!isBlock(node.data) || !isRgbLed(node.data.properties)) continue;
    const incoming = edges.filter(edge => edge.target === node.id && edge.targetHandle?.startsWith(RGB_PRESET_PREFIX));
    if (!incoming.length) continue;
    if (edges.some(edge => edge.target === node.id && !edge.targetHandle?.startsWith(RGB_PRESET_PREFIX)))
      throw new Error("LED RGB: usa i preset oppure gli ingressi colore/RGB, scollegando l’altra tipologia.");
    const config = rgbLedPresets(node.data.properties);
    for (const edge of incoming) if (!config.presets.some(preset => RGB_PRESET_PREFIX + preset.id === edge.targetHandle))
      throw new Error("LED RGB: il preset collegato non esiste più.");
    const id = `rgb-presets:${node.id}`;
    nodes.push({ layer: "device-processing", id, data: { kind: "block", blockTypeId: "led_driver",
      catalogEntryId: "native.led_driver", properties: { ledDriverConfig: JSON.stringify({ ...config, outputMode: "hex" }) } } });
    edges = edges.map(edge => incoming.includes(edge) ? { ...edge, target: id, targetHandle: edge.targetHandle!.slice(RGB_PRESET_PREFIX.length) } : edge);
    const channels = JSON.parse(String(node.data.properties.sensorChannelsJson ?? "[]")) as { id: string; direction: string; dataType?: string }[];
    const color = channels.find(channel => channel.direction === "write" && channel.dataType === "string");
    if (!color) throw new Error("LED RGB: ingresso colore non disponibile.");
    edges.push({ layer: "device-processing", id: `${id}:color`, source: id, sourceHandle: "0", target: node.id, targetHandle: color.id });
  }
  return { ...graph, nodes, edges };
}
/** Fold legacy generators into their RGB LEDs, preserving preset trigger wires. */
export function migrateRgbLedGenerators(project: ProjectV1): ProjectV1 {
  let changed = false;
  const graphs = project.deviceGraphs.map(graph => {
    let nodes = [...graph.nodes]; let edges = [...graph.edges];
    for (const generator of graph.nodes) {
      if (!isBlock(generator.data) || generator.data.blockTypeId !== "led_driver") continue;
      const outgoing = edges.filter(edge => edge.source === generator.id);
      const targets = [...new Set(outgoing.map(edge => edge.target))];
      if (!outgoing.length || !targets.every(id => nodes.some(node => node.id === id && isBlock(node.data) && isRgbLed(node.data.properties)))) continue;
      const config = readLedDriver(generator.data.properties);
      // A partly wired RGB generator retains its original semantics until edited.
      if (config.outputMode === "rgb" && targets.some(id => outgoing.filter(edge => edge.target === id).length !== 3)) continue;
      const incoming = edges.filter(edge => edge.target === generator.id);
      nodes = nodes.filter(node => node.id !== generator.id).map(node => targets.includes(node.id) && isBlock(node.data)
        ? { ...node, data: { ...node.data, properties: { ...node.data.properties, rgbLedPresets: JSON.stringify({ ...config, outputMode: "hex" }) } } } : node);
      edges = edges.filter(edge => edge.source !== generator.id && edge.target !== generator.id);
      for (const target of targets) for (const edge of incoming)
        edges.push({ ...edge, id: `${edge.id}:rgb:${target}`, target, targetHandle: RGB_PRESET_PREFIX + (edge.targetHandle ?? "0") });
      changed = true;
    }
    return { ...graph, nodes, edges };
  });
  return changed ? { ...project, deviceGraphs: graphs } : project;
}

function isBlock(data: unknown): data is BlockNodeData { return !!data && typeof data === "object" && isBlockNodeData(data as DeviceProcessingNodeData); }
