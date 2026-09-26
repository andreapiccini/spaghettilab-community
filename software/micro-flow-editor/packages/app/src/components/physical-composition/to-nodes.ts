import type { AuthoringMetadata, GraphState } from "@spaghettilab/domain";
import { isModuleNodeData, type PhysicalCompositionNodeData } from "@spaghettilab/physical-composition-model";
import type { Node } from "@xyflow/react";
import type { LocaleId } from "../../lib/locale.js";
import { physicalProtocolCopy } from "../../lib/physical-protocol-copy.js";
import { NODE_KIND_CONFIG } from "./node-kinds.js";

export type PhysicalNodeData = {
  readonly domainId: string;
  readonly kind: PhysicalCompositionNodeData["kind"];
  readonly label: string;
  readonly subtitle: string;
  readonly hasError: boolean;
};

/**
 * Direct conversion, not `@spaghettilab/react-flow-adapter`'s `toReactFlowNodes()` —
 * that helper resolves every node against `EditorModel` (S042), which only knows
 * Module Driver/Profile `typeId`s. Backbone/Power/Connector/External-device have no
 * catalog type at all (they're pure authoring entities, see `entities.ts`'s own doc
 * comment), so running them through `resolveNodeType()` would report every one of
 * them as an unrecognized placeholder — wrong, not just unhelpful. This maps the
 * five real `PhysicalCompositionNodeData` kinds directly instead.
 */
export function toPhysicalNodes(
  graphState: GraphState<"physical-composition">,
  authoringMetadata: Readonly<Record<string, AuthoringMetadata>>,
  errorNodeIds: ReadonlySet<string>,
  locale: LocaleId = "it",
): Node<PhysicalNodeData>[] {
  const proto = physicalProtocolCopy(locale);
  return graphState.nodes.map((node) => {
    const meta = authoringMetadata[node.id];
    const data = node.data as PhysicalCompositionNodeData;
    const kindLabel = data.kind === "external-device" ? proto.externalDevice : NODE_KIND_CONFIG[data.kind].label;
    return {
      id: node.id,
      type: "physical",
      position: meta?.position ?? { x: 0, y: 0 },
      selected: meta?.selected ?? false,
      data: {
        domainId: node.id,
        kind: data.kind,
        label: meta?.comment && meta.comment.trim() !== "" ? meta.comment : kindLabel,
        subtitle: subtitleFor(data, proto),
        hasError: errorNodeIds.has(node.id),
      },
    };
  });
}

function subtitleFor(data: PhysicalCompositionNodeData, proto: ReturnType<typeof physicalProtocolCopy>): string {
  if (isModuleNodeData(data)) return `${data.driverTypeId} · Port ${data.portId} · Bay ${data.bayId}`;
  switch (data.kind) {
    case "backbone":
      return data.variant;
    case "power-source":
      return data.passive ? proto.passive : proto.managed;
    case "connector":
      return data.pinout ?? "—";
    case "external-device":
      return data.description ?? "—";
  }
}
