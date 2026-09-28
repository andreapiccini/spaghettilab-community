import { domainError, type DomainError } from "./errors.js";
import type { GraphLayer } from "./graph-layer.js";
import { err, ok, type Result } from "./result.js";

export const GraphErrorCode = {
  CROSS_LAYER_REFERENCE: "domain.graph.cross_layer_reference",
  DUPLICATE_NODE: "domain.graph.duplicate_node",
  DANGLING_EDGE_ENDPOINT: "domain.graph.dangling_edge_endpoint",
  NODE_NOT_FOUND: "domain.graph.node_not_found",
  EDGE_NOT_FOUND: "domain.graph.edge_not_found",
  NODE_HAS_DEPENDENT_EDGES: "domain.graph.node_has_dependent_edges",
} as const;

export type GraphNode<Layer extends GraphLayer, Id extends string, Data> = {
  readonly layer: Layer;
  readonly id: Id;
  /** Deployable content only — never authoring metadata; see `authoring-metadata.ts`. */
  readonly data: Data;
};

export type GraphEdge<Layer extends GraphLayer, Id extends string, EdgeId extends string> = {
  readonly layer: Layer;
  readonly id: EdgeId;
  readonly source: Id;
  readonly target: Id;
  /**
   * Which named port on `source`/`target` this edge connects — undefined
   * means "the node's only port" (true for every layer that only ever wires
   * whole nodes together). A multi-port node (e.g. a Device Processing Block
   * with several typed input/output ports, S071) needs these to disambiguate;
   * mirrors `struct spaghetti_edge_config`'s real
   * `source_port_or_field`/`target_input` fields (`firmware/backbone/include/spaghetti/config.h`),
   * which is why this lives on the generic `GraphEdge` rather than being
   * bolted onto one layer's node `data`.
   */
  readonly sourceHandle?: string;
  readonly targetHandle?: string;
};

/**
 * A graph whose nodes/edges all belong to exactly one `GraphLayer`. Adding a
 * node or edge tagged with a different layer, or an edge whose endpoint isn't
 * a registered node of this graph, is rejected with a structured error
 * instead of silently accepted — this is the runtime half of "riferimenti fra
 * layer non consentiti sono rifiutati" (the type-level half is that `Id` and
 * `EdgeId` are branded per S012, so a `ModuleId` can't be passed where the
 * caller declared a `NodeRedResourceId` is expected).
 */
export class Graph<Layer extends GraphLayer, Id extends string, EdgeId extends string, Data> {
  private readonly nodeMap = new Map<Id, GraphNode<Layer, Id, Data>>();
  private readonly edgeList: GraphEdge<Layer, Id, EdgeId>[] = [];

  constructor(readonly layer: Layer) {}

  addNode(node: GraphNode<Layer, Id, Data>): Result<GraphNode<Layer, Id, Data>, DomainError> {
    if (node.layer !== this.layer) {
      return err(
        domainError({
          code: GraphErrorCode.CROSS_LAYER_REFERENCE,
          path: [this.layer, "nodes", node.id],
          target: node.id,
          remediation: `A "${node.layer}" node cannot be added to the "${this.layer}" graph — build it in the graph matching its own layer instead.`,
        }),
      );
    }
    if (this.nodeMap.has(node.id)) {
      return err(
        domainError({
          code: GraphErrorCode.DUPLICATE_NODE,
          path: [this.layer, "nodes", node.id],
          target: node.id,
          remediation: `A node with ID "${node.id}" already exists in this graph.`,
        }),
      );
    }
    this.nodeMap.set(node.id, node);
    return ok(node);
  }

  addEdge(
    edge: GraphEdge<Layer, Id, EdgeId>,
  ): Result<GraphEdge<Layer, Id, EdgeId>, DomainError> {
    if (edge.layer !== this.layer) {
      return err(
        domainError({
          code: GraphErrorCode.CROSS_LAYER_REFERENCE,
          path: [this.layer, "edges", edge.id],
          target: edge.id,
          remediation: `A "${edge.layer}" edge cannot be added to the "${this.layer}" graph — cross-layer connections belong to the System Automation Graph (S110), not a direct edge here.`,
        }),
      );
    }
    for (const endpoint of [edge.source, edge.target] as const) {
      if (!this.nodeMap.has(endpoint)) {
        return err(
          domainError({
            code: GraphErrorCode.DANGLING_EDGE_ENDPOINT,
            path: [this.layer, "edges", edge.id],
            target: endpoint,
            remediation: `Edge "${edge.id}" references node "${endpoint}", which is not registered in this graph. Add the node first.`,
          }),
        );
      }
    }
    this.edgeList.push(edge);
    return ok(edge);
  }

  getNode(id: Id): GraphNode<Layer, Id, Data> | undefined {
    return this.nodeMap.get(id);
  }

  /** Replaces an existing node's `data` in place — the edit counterpart to `addNode`, keeping every edge that referenced this ID (an add-then-remove round trip would otherwise cascade-delete them for no domain reason). */
  updateNode(node: GraphNode<Layer, Id, Data>): Result<GraphNode<Layer, Id, Data>, DomainError> {
    if (node.layer !== this.layer) {
      return err(
        domainError({
          code: GraphErrorCode.CROSS_LAYER_REFERENCE,
          path: [this.layer, "nodes", node.id],
          target: node.id,
          remediation: `A "${node.layer}" node cannot be updated in the "${this.layer}" graph — build it in the graph matching its own layer instead.`,
        }),
      );
    }
    if (!this.nodeMap.has(node.id)) {
      return err(
        domainError({
          code: GraphErrorCode.NODE_NOT_FOUND,
          path: [this.layer, "nodes", node.id],
          target: node.id,
          remediation: `No node with ID "${node.id}" exists in this graph — use addNode() to create it first.`,
        }),
      );
    }
    this.nodeMap.set(node.id, node);
    return ok(node);
  }

  getNodes(): readonly GraphNode<Layer, Id, Data>[] {
    return [...this.nodeMap.values()];
  }

  getEdges(): readonly GraphEdge<Layer, Id, EdgeId>[] {
    return [...this.edgeList];
  }

  /**
   * Removes a node, but only if no edge still references it — a caller must
   * remove those edges first (or use `removeNodeCascade`). This mirrors
   * `addEdge`'s own dangling-endpoint check: the graph never ends up with an
   * edge pointing at a node that no longer exists.
   */
  removeNode(id: Id): Result<void, DomainError> {
    if (!this.nodeMap.has(id)) {
      return err(
        domainError({
          code: GraphErrorCode.NODE_NOT_FOUND,
          path: [this.layer, "nodes", id],
          target: id,
          remediation: `No node with ID "${id}" exists in this graph.`,
        }),
      );
    }
    const dependentEdges = this.edgeList.filter((e) => e.source === id || e.target === id);
    if (dependentEdges.length > 0) {
      return err(
        domainError({
          code: GraphErrorCode.NODE_HAS_DEPENDENT_EDGES,
          path: [this.layer, "nodes", id],
          target: id,
          remediation: `Remove the ${dependentEdges.length} edge(s) referencing node "${id}" first, or use removeNodeCascade().`,
        }),
      );
    }
    this.nodeMap.delete(id);
    return ok(undefined);
  }

  /** Removes a node and every edge that referenced it, returning which edges were removed so a caller (e.g. the React Flow adapter) can update its own view accordingly. */
  removeNodeCascade(id: Id): Result<{ removedEdgeIds: readonly EdgeId[] }, DomainError> {
    if (!this.nodeMap.has(id)) {
      return err(
        domainError({
          code: GraphErrorCode.NODE_NOT_FOUND,
          path: [this.layer, "nodes", id],
          target: id,
          remediation: `No node with ID "${id}" exists in this graph.`,
        }),
      );
    }
    const removedEdgeIds: EdgeId[] = [];
    for (let i = this.edgeList.length - 1; i >= 0; i--) {
      const edge = this.edgeList[i]!;
      if (edge.source === id || edge.target === id) {
        removedEdgeIds.push(edge.id);
        this.edgeList.splice(i, 1);
      }
    }
    this.nodeMap.delete(id);
    return ok({ removedEdgeIds });
  }

  removeEdge(id: EdgeId): Result<void, DomainError> {
    const index = this.edgeList.findIndex((e) => e.id === id);
    if (index === -1) {
      return err(
        domainError({
          code: GraphErrorCode.EDGE_NOT_FOUND,
          path: [this.layer, "edges", id],
          target: id,
          remediation: `No edge with ID "${id}" exists in this graph.`,
        }),
      );
    }
    this.edgeList.splice(index, 1);
    return ok(undefined);
  }
}

export function createPhysicalCompositionGraph<
  Id extends string,
  EdgeId extends string,
  Data,
>(): Graph<"physical-composition", Id, EdgeId, Data> {
  return new Graph("physical-composition");
}

export function createDeviceProcessingGraph<
  Id extends string,
  EdgeId extends string,
  Data,
>(): Graph<"device-processing", Id, EdgeId, Data> {
  return new Graph("device-processing");
}

export function createSystemAutomationGraph<
  Id extends string,
  EdgeId extends string,
  Data,
>(): Graph<"system-automation", Id, EdgeId, Data> {
  return new Graph("system-automation");
}

/**
 * A deterministic, metadata-free view of a graph's deployable content —
 * nodes and edges only, sorted by ID so unrelated authoring changes (adding
 * nodes in a different order) don't change the result. Used to prove that
 * authoring metadata (position, viewport, ...) never affects what would be
 * compiled — see `authoring-metadata.ts`. Not the canonical Config
 * serialization (that is S072's job); this is only a domain-level equality
 * check.
 */
export function deployableSnapshot<
  Layer extends GraphLayer,
  Id extends string,
  EdgeId extends string,
  Data,
>(graph: Graph<Layer, Id, EdgeId, Data>): string {
  const nodes = [...graph.getNodes()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((n) => ({ id: n.id, data: n.data }));
  const edges = [...graph.getEdges()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle }));
  return JSON.stringify({ layer: graph.layer, nodes, edges });
}
