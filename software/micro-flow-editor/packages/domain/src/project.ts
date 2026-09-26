import type { AuthoringMetadata } from "./authoring-metadata.js";
import { domainError, DomainErrorCode, type DomainError } from "./errors.js";
import type { GraphEdge, GraphNode } from "./graph.js";
import type { GraphLayer } from "./graph-layer.js";
import { contentHash } from "./hash.js";
import type {
  CoreBindingId,
  DeploymentId,
  ProjectId,
} from "./ids.js";
import { err, ok, type Result } from "./result.js";

export const PROJECT_SCHEMA_VERSION = 1 as const;

/**
 * Deployable content of one graph, exactly as persisted in a Project — plain
 * data, not the mutable `Graph` class from graph.ts (which exists to
 * *validate* while authoring, not to be the storage format). Node/edge
 * `data` is `unknown` here: S050/S070/S110 have not defined the concrete
 * Physical Composition / Device Processing / System Automation payload
 * shapes yet, so this stays a placeholder they will narrow, not something
 * S014 can honestly commit to today.
 */
export type GraphState<Layer extends GraphLayer> = {
  readonly layer: Layer;
  readonly nodes: ReadonlyArray<GraphNode<Layer, string, unknown>>;
  readonly edges: ReadonlyArray<GraphEdge<Layer, string, string>>;
};

/** REACT_FLOW_ARCHITECTURE.md § Modello dati principale — CoreBinding. */
export type CoreBindingRecord = {
  readonly bindingId: CoreBindingId;
  readonly expectedDeviceId: string;
  readonly connectionProfileId: string;
  readonly lastKnownVariant?: string;
  readonly lastKnownProfile?: string;
  readonly lastKnownFeatureSet?: readonly string[];
};

/** A Device Profile or Capability Pack the project needs installed to deploy — "profile/pack/version/hash". */
export type RequiredArtifact = {
  readonly profileId?: string;
  readonly packId?: string;
  readonly version: string;
  readonly hash: string;
};

/** REACT_FLOW_ARCHITECTURE.md § Modello dati principale — DeploymentRecord. */
export type DeploymentRecordV1 = {
  readonly deploymentId: DeploymentId;
  readonly target: string;
  readonly timestamp: string; // ISO 8601
  readonly sourceProjectHash: string;
  readonly configGeneration?: number;
  readonly configHash?: string;
  readonly nodeRedRevision?: string;
  readonly catalogFingerprint?: string;
  readonly featureSetHash?: string;
  readonly outcome: "success" | "failure";
};

/**
 * The persisted authoring model for one project. Only ever produced by
 * `CommandStack` (see `commands.ts`) — no direct field mutation, so every
 * change is undo/redo-able and none is untracked (S014 "Fine task").
 */
export type ProjectV1 = {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly coreBindings: readonly CoreBindingRecord[];
  readonly physicalGraphs: readonly GraphState<"physical-composition">[];
  readonly deviceGraphs: readonly GraphState<"device-processing">[];
  readonly systemAutomationGraph: GraphState<"system-automation">;
  readonly requiredArtifacts: readonly RequiredArtifact[];
  readonly deploymentRecords: readonly DeploymentRecordV1[];
  /**
   * Position, viewport, selection, comment, group — keyed by node ID across
   * every graph. Persisted so the editor looks the same next session, but
   * deliberately excluded from `canonicalProjectHash` — see that function.
   */
  readonly authoringMetadata: Readonly<Record<string, AuthoringMetadata>>;
  /**
   * Canonical JSON strings of authored `@spaghettilab/device-profile-package`
   * packages (Device Profile Studio, S061-S063) — kept opaque here the same
   * way `GraphState.data` is: `domain` has no dependency on that package, so
   * this stores whatever it already serializes to, re-validated by
   * `importProfilePackageJson()` wherever it's read. A personal authoring
   * library, not deployable content by itself (only instantiating one as a
   * Module — already tracked in `physicalGraphs` — changes what's deployed),
   * so this is excluded from `canonicalProjectHash` for the same reason
   * `authoringMetadata` is. Optional on read for projects saved before this
   * field existed — `validateProjectV1` defaults a missing value to `[]`
   * rather than rejecting old data.
   */
  readonly deviceProfilePackages: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(path: string[], target: unknown, remediation: string): DomainError {
  return domainError({
    code: DomainErrorCode.INVALID_SCHEMA,
    path,
    target: String(target),
    remediation,
  });
}

/**
 * Runtime validator for data of unknown origin (import, storage, network) —
 * `ProjectV1`'s static type only helps once something already claims to be
 * one. Collects every problem found instead of stopping at the first, so a
 * caller can report all of them at once.
 */
export function validateProjectV1(raw: unknown): Result<ProjectV1, DomainError[]> {
  const errors: DomainError[] = [];

  if (!isRecord(raw)) {
    return err([invalid(["$"], raw, "Provide a JSON object as the Project root.")]);
  }

  if (raw.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    errors.push(
      invalid(
        ["schemaVersion"],
        raw.schemaVersion,
        `Expected schemaVersion ${PROJECT_SCHEMA_VERSION}; run migration first if this is older.`,
      ),
    );
  }
  if (typeof raw.projectId !== "string" || raw.projectId === "") {
    errors.push(invalid(["projectId"], raw.projectId, "projectId must be a non-empty string."));
  }
  if (typeof raw.name !== "string") {
    errors.push(invalid(["name"], raw.name, "name must be a string."));
  }
  if (!Array.isArray(raw.coreBindings)) {
    errors.push(invalid(["coreBindings"], raw.coreBindings, "coreBindings must be an array."));
  }
  if (!Array.isArray(raw.physicalGraphs)) {
    errors.push(invalid(["physicalGraphs"], raw.physicalGraphs, "physicalGraphs must be an array."));
  }
  if (!Array.isArray(raw.deviceGraphs)) {
    errors.push(invalid(["deviceGraphs"], raw.deviceGraphs, "deviceGraphs must be an array."));
  }
  if (!isRecord(raw.systemAutomationGraph)) {
    errors.push(
      invalid(
        ["systemAutomationGraph"],
        raw.systemAutomationGraph,
        "systemAutomationGraph must be a single graph object, not an array.",
      ),
    );
  }
  if (!Array.isArray(raw.requiredArtifacts)) {
    errors.push(invalid(["requiredArtifacts"], raw.requiredArtifacts, "requiredArtifacts must be an array."));
  }
  if (!Array.isArray(raw.deploymentRecords)) {
    errors.push(invalid(["deploymentRecords"], raw.deploymentRecords, "deploymentRecords must be an array."));
  }
  if (!isRecord(raw.authoringMetadata)) {
    errors.push(invalid(["authoringMetadata"], raw.authoringMetadata, "authoringMetadata must be an object."));
  }
  if (raw.deviceProfilePackages !== undefined && !Array.isArray(raw.deviceProfilePackages)) {
    errors.push(invalid(["deviceProfilePackages"], raw.deviceProfilePackages, "deviceProfilePackages must be an array."));
  }

  if (errors.length > 0) {
    return err(errors);
  }
  // Backward-compatible default for projects saved before this field existed.
  return ok({ ...(raw as unknown as ProjectV1), deviceProfilePackages: Array.isArray(raw.deviceProfilePackages) ? raw.deviceProfilePackages : [] });
}

/** Creates an empty, valid ProjectV1 — the starting point for a new project. */
export function createEmptyProject(projectId: ProjectId, name: string): ProjectV1 {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId,
    name,
    coreBindings: [],
    physicalGraphs: [],
    deviceGraphs: [],
    systemAutomationGraph: { layer: "system-automation", nodes: [], edges: [] },
    requiredArtifacts: [],
    deploymentRecords: [],
    authoringMetadata: {},
    deviceProfilePackages: [],
  };
}

/**
 * Persist a project as JSON. Graph node `data` may contain `bigint` property
 * values (firmware int64 defaults from the processing catalog) — stringify
 * those as decimal strings so `JSON.stringify` does not throw
 * ("Do not know how to serialize a BigInt"), matching the lossless int64
 * JSON boundary used elsewhere in the stack.
 */
export function exportProjectV1(project: ProjectV1): string {
  return JSON.stringify(project, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2);
}

export function importProjectV1(json: string): Result<ProjectV1, DomainError[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    return err([
      domainError({
        code: DomainErrorCode.INVALID_SCHEMA,
        path: ["$"],
        target: "json",
        remediation: "Provide well-formed JSON.",
        cause,
      }),
    ]);
  }
  return validateProjectV1(parsed);
}

function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function normalizeGraph<Layer extends GraphLayer>(graph: GraphState<Layer>) {
  return {
    layer: graph.layer,
    nodes: sortById(graph.nodes).map((n) => ({ id: n.id, data: n.data })),
    edges: sortById(graph.edges).map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

/**
 * Fingerprint of a Project's *deployable* content only. Two projects that
 * differ solely in `authoringMetadata`, or in the insertion order of any
 * array whose order isn't semantically significant, hash identically — this
 * is what S014's "hash non cambia per ordine non significativo o metadata
 * visuali esclusi" verification checks.
 */
export function canonicalProjectHash(project: ProjectV1): string {
  return contentHash({
    schemaVersion: project.schemaVersion,
    projectId: project.projectId,
    name: project.name,
    coreBindings: [...project.coreBindings].sort((a, b) =>
      a.bindingId < b.bindingId ? -1 : a.bindingId > b.bindingId ? 1 : 0,
    ),
    physicalGraphs: project.physicalGraphs.map(normalizeGraph),
    deviceGraphs: project.deviceGraphs.map(normalizeGraph),
    systemAutomationGraph: normalizeGraph(project.systemAutomationGraph),
    requiredArtifacts: [...project.requiredArtifacts].sort((a, b) =>
      a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0,
    ),
    deploymentRecords: [...project.deploymentRecords].sort((a, b) =>
      a.deploymentId < b.deploymentId ? -1 : a.deploymentId > b.deploymentId ? 1 : 0,
    ),
    // authoringMetadata is intentionally absent from this object.
  });
}
