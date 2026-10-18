import { findCatalogEntryById } from "@spaghettilab/processing-block-catalog";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../state/locale-context.js";
import { PortProtocolProvider } from "../../state/port-protocol-context.js";
import { SessionProvider } from "../../state/session-context.js";
import { nodeDataFromCatalogEntry } from "./catalog-to-node.js";
import { NodeInspector } from "./NodeInspector.js";

function wrap(node: ReactNode): ReactNode {
  return createElement(
    LocaleProvider,
    null,
    createElement(
      SessionProvider,
      null,
      createElement(PortProtocolProvider, null, node),
    ),
  );
}

describe("NodeInspector square wave", () => {
  it("renders after a catalog drop while a Core binding is selected", () => {
    const entry = findCatalogEntryById("appblocks.square_wave");
    const data = entry ? nodeDataFromCatalogEntry(entry, undefined) : null;
    expect(data?.kind).toBe("block");
    if (!data) throw new Error("expected square wave block");
    const html = renderToString(
      wrap(
        createElement(NodeInspector, {
          driverBindingId: "core",
          mode: { kind: "edit", nodeId: "sq", data, comment: "Onda quadra" },
          moduleOptions: [],
          existingNodes: [{ layer: "device-processing", id: "sq", data }],
          existingEdges: [],
          nodeLabel: (id) => id,
          knownModuleNodeIds: new Set<string>(),
          onSave: () => undefined,
          onClose: () => undefined,
        }),
      ),
    );
    expect(html).toContain("Onda quadra");
    expect(html).toContain("Periodo");
  });
});
