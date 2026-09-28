export type CorrelationId = number;

export type ProtocolStatus =
  | "ok"
  | "invalid_argument"
  | "unsupported"
  | "unauthorized"
  | "conflict"
  | "busy"
  | "unavailable"
  | "timeout"
  | "resource_exhausted"
  | "malformed_request"
  | "internal_error";

export const PROTOCOL_STATUS_CODES: Record<ProtocolStatus, number> = {
  ok: 0,
  invalid_argument: 1,
  unsupported: 2,
  unauthorized: 3,
  conflict: 4,
  busy: 5,
  unavailable: 6,
  timeout: 7,
  resource_exhausted: 8,
  malformed_request: 9,
  internal_error: 10,
};

export const PROTOCOL_STATUS_NAMES: Record<number, ProtocolStatus> = {
  0: "ok",
  1: "invalid_argument",
  2: "unsupported",
  3: "unauthorized",
  4: "conflict",
  5: "busy",
  6: "unavailable",
  7: "timeout",
  8: "resource_exhausted",
  9: "malformed_request",
  10: "internal_error",
};

export enum Operation {
  GET_CATALOG = 1,
  GET_STATUS = 2,
  APPLY_CONFIG = 3,
  LIST_DISCOVERY = 4,
  SCAN_DISCOVERY = 5,
  ACCEPT_DISCOVERY = 6,
  MODULE_COMMAND = 7,
  GET_UPDATE_STATUS = 8,
  GET_CAPABILITIES = 9,
  GET_CONNECTIVITY_STATUS = 10,
  ACQUIRE_CONNECTIVITY_LEASE = 11,
  RELEASE_CONNECTIVITY_LEASE = 12,
  OPEN_NETWORK_MAINTENANCE = 13,
  OPEN_WIFI_UPDATE = 14,
  FACTORY_RESET = 15,
  GET_CONFIG = 16,
  VALIDATE_CONFIG = 17,
  GET_AUDIT_LOG = 18,
  GET_JOB_STATUS = 19,
  GET_TOPOLOGY = 20,
  GET_RESOURCES = 21,
  LIST_DEVICE_PROFILES = 22,
  GET_DEVICE_PROFILE = 23,
  VALIDATE_DEVICE_PROFILE = 24,
  INSTALL_DEVICE_PROFILE = 25,
  REMOVE_DEVICE_PROFILE = 26,
  GET_FEATURES = 27,
}

export enum EventType {
  RECORD = 1,
  STATUS = 2,
  DISCOVERY = 3,
  CONNECTIVITY = 4,
}

export type WireValueType = "bool" | "int64" | "uint64" | "text" | "bytes";

/** Internal lossless wire value (INT64/UINT64 are bigint). */
export type WireValue =
  | { readonly type: "bool"; readonly value: boolean }
  | { readonly type: "int64"; readonly value: bigint }
  | { readonly type: "uint64"; readonly value: bigint }
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "bytes"; readonly value: Uint8Array };

/**
 * JSON / Node-RED boundary: number only in JS safe integer range;
 * otherwise decimal string. Bytes are lowercase hex.
 */
export type JsonWireValue = boolean | number | string;

/** Property map keyed by field id (decimal string) or catalog field name. */
export type PropertyValues = Record<string, JsonWireValue>;

export interface ModuleConfig {
  key: number;
  port: number;
  bay?: number;
  powerRail?: number;
  type: string;
  properties: PropertyValues;
  /** Wire field types for lossless re-encode (field id → type). */
  propertyTypes?: Record<string, WireValueType>;
}

export interface ScheduleConfig {
  enabled: boolean;
  sourceKey: number;
  periodMs: number;
}

export interface RuleConfig {
  key: number;
  type: string;
  properties: PropertyValues;
  propertyTypes?: Record<string, WireValueType>;
}

export interface BlockConfig {
  key: number;
  type: string;
  minVersion: number;
  exactVersion: number;
  properties: PropertyValues;
  propertyTypes?: Record<string, WireValueType>;
}

export interface EdgeConfig {
  sourceKey: number;
  sourcePortOrField: number;
  targetKey: number;
  targetInput: number;
  sourceKind: number;
}

export interface MqttConfig {
  enabled: boolean;
  host: string;
  port: number;
  baseTopic: string;
  security: number;
  credentialId: number;
}

export interface EnergyPolicy {
  availability: number;
  windowMs: number;
  periodMs: number;
}

/** Wire Config snapshot (CBOR wire version 4 / in-memory Config v5). */
export interface SpaghettiConfig {
  version: number;
  modules: ModuleConfig[];
  schedules: ScheduleConfig[];
  rules: RuleConfig[];
  blocks: BlockConfig[];
  edges: EdgeConfig[];
  connectivityPolicy: number;
  energyPolicy: EnergyPolicy;
  mqtt: MqttConfig;
}

export interface ConfigRevision {
  generation: number;
  sha256: string;
}

export interface ConfigSnapshot {
  config: SpaghettiConfig;
  revision: ConfigRevision;
}

export interface ApplyResult {
  changed: boolean;
  revision: ConfigRevision;
}

export interface FunctionBay {
  id: number;
  ordinalFromField: number;
  availablePowerRails: number[];
  moduleKey?: number;
  admission?: number;
}

export interface HardwareFlow {
  id: number;
  portId: number;
  direction: "field_to_core" | "core_to_field" | "bidirectional";
  signalCount: 5;
  bays: FunctionBay[];
}

export interface PowerRail {
  id: number;
  assurance: "unmanaged" | "switched" | "switched_and_measured";
  minMicrovolts?: number;
  maxMicrovolts?: number;
  maxTotalMicroamps?: number;
}

export interface CoreTopology {
  flows: HardwareFlow[];
  powerRails: PowerRail[];
}

export type FieldSemantic =
  | "value"
  | "module_key_ref"
  | "record_field_ref"
  | "command_ref"
  | "port_ref"
  | "flow_ref"
  | "bay_ref"
  | "power_rail_ref"
  | "duration_ms";

export interface CatalogField {
  fieldId: number;
  name: string;
  type: WireValueType;
  semantic: FieldSemantic;
  referenceGroup: number;
  unit?: string;
  description?: string;
}

export interface CatalogCommand {
  commandId: number;
  name: string;
}

export interface CatalogDriver {
  typeId: string;
  commandCount: number;
  commands: CatalogCommand[];
  fields: CatalogField[];
}

export interface Catalog {
  protocolVersion: number;
  configVersion: number;
  fingerprint: string;
  drivers: CatalogDriver[];
  driverCount: number;
}

export interface ModuleStatus {
  key: number;
  id: number;
  portId: number;
  state: number;
  endpointKind: number;
  endpointValueRaw: number;
  typeId: string;
}

export interface CoreStatus {
  state: number;
  mode: number;
  imageState: number;
  activeSlot: number;
  imageConfirmed: boolean;
  version: string;
  portCount: number;
  lastResetCause: number;
  healthState: number;
  modules: ModuleStatus[];
  bootId?: bigint;
  replayWindowMs?: number;
}

export interface ClientOptions {
  defaultTimeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  /** Declared Core replay window; retries after reconnect only within this. */
  replayWindowMs?: number;
}
