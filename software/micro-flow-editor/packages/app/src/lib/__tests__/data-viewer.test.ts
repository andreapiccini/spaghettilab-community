import { it, expect } from "vitest";
import { formatViewerValue } from "../data-viewer.js";
import {
  findCatalogEntryById,
  portsCompatible,
} from "@spaghettilab/processing-block-catalog";
import { prepareDriverDeployment } from "../driver-deployment-plan.js";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";
it("formats decimals, boolean, empty text, bytes and exact uint64 without coercion", () => {
  expect(formatViewerValue(23.456, 2).text).toBe("23,46");
  expect(formatViewerValue(18446744073709551615n).text).toBe("18446744073709551615");
  expect(formatViewerValue(false)).toMatchObject({ text: "false", type: "Booleano" });
  expect(formatViewerValue("").text).toBe("");
  expect(formatViewerValue(new Uint8Array([0, 255])).text).toBe("00 FF");
  expect(formatViewerValue(1.5, NaN).text).toBe("1,5");
});
it("accepts every source type in its wildcard input", () => {
  const input = findCatalogEntryById("appblocks.data_viewer")!.inputs![0]!;
  for (const domain of [
    "digital",
    "analog",
    "text",
    "bytes",
    "event",
    "quantity",
  ] as const)
    expect(
      portsCompatible(
        { id: "out", direction: "out", types: [{ domain, role: "misura" }] },
        input,
      ),
    ).toBe(true);
});
it("does not deploy an unconnected UI viewer or consume Core resources", () => {
  const graph = {
    layer: "device-processing",
    nodes: [
      {
        id: "view",
        layer: "device-processing",
        data: { kind: "block", blockTypeId: "ui.data_viewer", properties: {} },
      },
    ],
    edges: [],
  } as const;
  const result = prepareDriverDeployment({} as never, "master", {
    physicalGraph: { layer: "physical-composition", nodes: [], edges: [] },
    processingGraph: graph,
    mqtt: DISABLED_MQTT,
    connectivity: 0,
    energy: DEFAULT_ENERGY,
  });
  expect(result.input.processingGraph.nodes).toHaveLength(0);
  expect(result.profiles).toHaveLength(0);
});
