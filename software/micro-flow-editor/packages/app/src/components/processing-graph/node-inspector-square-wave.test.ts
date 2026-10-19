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
    expect(html).not.toContain("Che segnale vuoi generare?");

  });
  it("offers only trigger generation without waveform settings", () => {
    const entry = findCatalogEntryById("appblocks.manual_trigger")!;
    const data = nodeDataFromCatalogEntry(entry, undefined)!;
    const html = renderToString(wrap(createElement(NodeInspector, {
      mode: { kind: "edit", nodeId: "signal", data, comment: "Generatore di trigger" },
      moduleOptions: [], existingNodes: [{ layer: "device-processing", id: "signal", data }],
      existingEdges: [], nodeLabel: (id: string) => id, knownModuleNodeIds: new Set<string>(),
      onSave: () => undefined, onClose: () => undefined,
    })));
    expect(html).toContain("Attiva");
    expect(html).not.toContain("Alterna acceso/spento");
    expect(html).not.toContain("Invia impulso");
    expect(html).not.toContain("ni-signal-mode");
    expect(html).toContain("Schedule");
    expect(html).not.toContain("Duty cycle");
    expect(entry.label).toBe("Attiva azione");
  });

  it("shows only Output for the fixed status LED", () => {
    const baseData = nodeDataFromCatalogEntry(findCatalogEntryById("appblocks.led")!, undefined)!;
    if (baseData.kind !== "block") throw new Error("expected LED block");
    const data = { ...baseData, properties: { ...baseData.properties, statusLed: true } };
    const html = renderToString(wrap(createElement(NodeInspector, {
      mode: { kind: "edit", nodeId: "status", data, comment: "STATUS LED" },
      moduleOptions: [], existingNodes: [{ layer: "device-processing", id: "status", data }],
      existingEdges: [], nodeLabel: (id: string) => id, knownModuleNodeIds: new Set<string>(),
      onSave: () => undefined, onClose: () => undefined,
    })));
    expect(html).toContain("Output");
    expect(html).not.toContain('title="Input"');
    expect(html).not.toContain('ni-blocktype');
    expect(html).not.toContain('ni-name');
    expect(html).not.toContain("Soglia");
    expect(html).not.toContain("Negato");
    expect(html).not.toContain("Sink su comando");
  });

});
