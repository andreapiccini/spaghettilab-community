import {
  assertOnlyKeys,
  boolField,
  bytesField,
  bytesToHex,
  decodeOne,
  encodeArray,
  encodeBool,
  encodeBytes,
  encodeEmptyMap,
  encodeInt,
  encodeMap,
  encodeText,
  encodeUint,
  hexToBytes,
  int64Field,
  PAYLOAD_ABSOLUTE_MAX,
  ProtocolCodecError,
  PROTOCOL_VERSION,
  requireArray,
  requireBool,
  requireBytes,
  requireMap,
  requireText,
  requireU32,
  requireUint64,
  textField,
  u32Field,
  type CborValue,
} from "./codec.js";
import {
  inferWireType,
  integerFromJson,
  integerToJson,
  wireValueFromJson,
  wireValueToJson,
} from "./value.js";
import type {
  ApplyResult,
  BlockConfig,
  ConfigRevision,
  ConfigSnapshot,
  CoreStatus,
  EdgeConfig,
  EnergyPolicy,
  EventType,
  HardwareFlow,
  ModuleConfig,
  ModuleStatus,
  MqttConfig,
  Operation,
  PowerRail,
  PropertyValues,
  ProtocolStatus,
  RuleConfig,
  ScheduleConfig,
  SpaghettiConfig,
  WireValue,
  WireValueType,
} from "./types.js";
import { PROTOCOL_STATUS_CODES, PROTOCOL_STATUS_NAMES } from "./types.js";

export { PROTOCOL_VERSION, PAYLOAD_ABSOLUTE_MAX };

const CONFIG_WIRE_VERSION = 4;
const KEY_VERSION = 0;
const KEY_FIELD1 = 1;
const KEY_FIELD2 = 2;
const KEY_PAYLOAD = 3;

const FLOW_DIRECTIONS = ["field_to_core", "core_to_field", "bidirectional"] as const;
const RAIL_ASSURANCE = ["unmanaged", "switched", "switched_and_measured"] as const;

export type RequestEnvelope = {
  correlationId: number;
  operation: number;
  payload: Uint8Array;
};

export type ResponseEnvelope = {
  correlationId: number;
  status: ProtocolStatus;
  statusCode: number;
  payload: Uint8Array;
};

export type EventEnvelope = {
  sequence: number;
  type: number;
  payload: Uint8Array;
};

function encodeEnvelope(field1: number, field2: number, payload: Uint8Array): Uint8Array {
  if (payload.length > PAYLOAD_ABSOLUTE_MAX) {
    throw new ProtocolCodecError(`payload exceeds ${PAYLOAD_ABSOLUTE_MAX} bytes`);
  }
  return encodeMap([
    u32Field(KEY_VERSION, PROTOCOL_VERSION),
    u32Field(KEY_FIELD1, field1),
    u32Field(KEY_FIELD2, field2),
    bytesField(KEY_PAYLOAD, payload),
  ]);
}

function decodeEnvelope(bytes: Uint8Array): {
  field1: number;
  field2: number;
  payload: Uint8Array;
} {
  const map = requireMap(decodeOne(bytes), "envelope");
  assertOnlyKeys(map, [0, 1, 2, 3], "envelope");
  const version = requireU32(map, KEY_VERSION, "envelope");
  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolCodecError("unsupported envelope version");
  }
  const field1 = requireU32(map, KEY_FIELD1, "envelope");
  if (field1 === 0) {
    throw new ProtocolCodecError("correlation/sequence must be nonzero");
  }
  const field2 = requireU32(map, KEY_FIELD2, "envelope");
  const payload = requireBytes(map, KEY_PAYLOAD, "envelope");
  if (payload.length > PAYLOAD_ABSOLUTE_MAX) {
    throw new ProtocolCodecError("payload exceeds absolute maximum");
  }
  return { field1, field2, payload };
}

export function encodeRequest(request: RequestEnvelope): Uint8Array {
  if (request.correlationId === 0) {
    throw new ProtocolCodecError("correlationId must be nonzero");
  }
  if (request.operation < 1 || request.operation > 31) {
    throw new ProtocolCodecError(`invalid operation ${request.operation}`);
  }
  return encodeEnvelope(request.correlationId, request.operation, request.payload);
}

export function encodeResponse(
  correlationId: number,
  status: ProtocolStatus | number,
  payload: Uint8Array = new Uint8Array(),
): Uint8Array {
  const statusCode =
    typeof status === "number" ? status : PROTOCOL_STATUS_CODES[status];
  if (statusCode < 0 || statusCode > 10 || PROTOCOL_STATUS_NAMES[statusCode] === undefined) {
    throw new ProtocolCodecError(`unknown status ${status}`);
  }
  if (correlationId === 0) {
    throw new ProtocolCodecError("correlationId must be nonzero");
  }
  return encodeEnvelope(correlationId, statusCode, payload);
}

export function encodeEvent(type: number, sequence: number, payload: Uint8Array): Uint8Array {
  if (sequence === 0) throw new ProtocolCodecError("sequence must be nonzero");
  if (type < 1 || type > 4) throw new ProtocolCodecError(`invalid event type ${type}`);
  return encodeEnvelope(sequence, type, payload);
}

export function decodeRequest(bytes: Uint8Array): RequestEnvelope {
  const raw = decodeEnvelope(bytes);
  if (raw.field2 < 1 || raw.field2 > 31) {
    throw new ProtocolCodecError(`unsupported operation ${raw.field2}`);
  }
  return { correlationId: raw.field1, operation: raw.field2, payload: raw.payload };
}

export function decodeResponse(bytes: Uint8Array): ResponseEnvelope {
  const raw = decodeEnvelope(bytes);
  const name = PROTOCOL_STATUS_NAMES[raw.field2];
  if (name === undefined) {
    throw new ProtocolCodecError(`unknown status ${raw.field2}`);
  }
  return {
    correlationId: raw.field1,
    status: name,
    statusCode: raw.field2,
    payload: raw.payload,
  };
}

export function decodeEvent(bytes: Uint8Array): EventEnvelope {
  const raw = decodeEnvelope(bytes);
  if (raw.field2 < 1 || raw.field2 > 4) {
    throw new ProtocolCodecError(`unsupported event type ${raw.field2}`);
  }
  return { sequence: raw.field1, type: raw.field2 as EventType, payload: raw.payload };
}

export function encodeEmptyPayload(): Uint8Array {
  // Operation request with no body is a zero-length bstr in the envelope
  // (firmware `payload.size == 0` → CBOR `0x40`), not an empty map.
  return new Uint8Array();
}

export function encodeEmptyMapPayload(): Uint8Array {
  return encodeEmptyMap();
}

function encodeWireValue(value: WireValue): Uint8Array {
  switch (value.type) {
    case "bool":
      return encodeBool(value.value);
    case "int64":
      return encodeInt(value.value);
    case "uint64":
      return encodeUint(value.value);
    case "text":
      return encodeText(value.value);
    case "bytes":
      return encodeBytes(value.value);
    default: {
      const _e: never = value;
      return _e;
    }
  }
}

function decodeWireValue(value: CborValue): WireValue {
  switch (value.kind) {
    case "bool":
      return { type: "bool", value: value.value };
    case "uint":
      return { type: "uint64", value: value.value };
    case "int":
      return { type: "int64", value: value.value };
    case "text":
      return { type: "text", value: value.value };
    case "bytes":
      return { type: "bytes", value: value.value };
    default:
      throw new ProtocolCodecError(`unsupported property value kind ${value.kind}`);
  }
}

function resolveFieldId(
  key: string,
  nameToId?: Map<string, number>,
): number {
  if (/^\d+$/.test(key)) {
    const id = Number(key);
    if (id === 0) throw new ProtocolCodecError("field id must be nonzero");
    return id;
  }
  const id = nameToId?.get(key);
  if (id === undefined) {
    throw new ProtocolCodecError(`unknown property field "${key}"`);
  }
  return id;
}

function encodeProperties(
  properties: PropertyValues,
  propertyTypes?: Record<string, WireValueType>,
  nameToId?: Map<string, number>,
): Uint8Array {
  const pairs: Array<readonly [number, Uint8Array]> = [];
  for (const [key, json] of Object.entries(properties)) {
    const fieldId = resolveFieldId(key, nameToId);
    const type =
      propertyTypes?.[key] ??
      propertyTypes?.[String(fieldId)] ??
      inferWireType(json);
    const wire = wireValueFromJson(json, type);
    pairs.push([fieldId, encodeWireValue(wire)]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return encodeMap(pairs);
}

function decodeProperties(value: CborValue): {
  properties: PropertyValues;
  propertyTypes: Record<string, WireValueType>;
} {
  const map = requireMap(value, "properties");
  const properties: PropertyValues = {};
  const propertyTypes: Record<string, WireValueType> = {};
  for (const [fieldId, raw] of map.entries()) {
    const wire = decodeWireValue(raw);
    const key = String(fieldId);
    properties[key] = wireValueToJson(wire);
    propertyTypes[key] = wire.type;
  }
  return { properties, propertyTypes };
}

function encodeModule(module: ModuleConfig): Uint8Array {
  const pairs: Array<readonly [number, Uint8Array]> = [
    u32Field(0, module.key),
    u32Field(1, module.port),
    textField(2, module.type),
    [3, encodeProperties(module.properties, module.propertyTypes)],
  ];
  if (module.bay !== undefined) pairs.push(u32Field(4, module.bay));
  if (module.powerRail !== undefined) pairs.push(u32Field(5, module.powerRail));
  return encodeMap(pairs);
}

function decodeModule(entry: CborValue): ModuleConfig {
  const m = requireMap(entry, "module");
  assertOnlyKeys(m, [0, 1, 2, 3, 4, 5], "module");
  const props = decodeProperties(m.get(3)!);
  return {
    key: requireU32(m, 0, "module"),
    port: requireU32(m, 1, "module"),
    type: requireText(m, 2, "module"),
    properties: props.properties,
    propertyTypes: props.propertyTypes,
    bay: m.has(4) ? requireU32(m, 4, "module") : undefined,
    powerRail: m.has(5) ? requireU32(m, 5, "module") : undefined,
  };
}

function encodeSchedule(schedule: ScheduleConfig): Uint8Array {
  return encodeMap([
    u32Field(0, schedule.sourceKey),
    u32Field(1, schedule.periodMs),
    boolField(2, schedule.enabled),
  ]);
}

function decodeSchedule(entry: CborValue): ScheduleConfig {
  const m = requireMap(entry, "schedule");
  assertOnlyKeys(m, [0, 1, 2], "schedule");
  return {
    sourceKey: requireU32(m, 0, "schedule"),
    periodMs: requireU32(m, 1, "schedule"),
    enabled: requireBool(m, 2, "schedule"),
  };
}

function encodeRule(rule: RuleConfig): Uint8Array {
  return encodeMap([
    u32Field(0, rule.key),
    textField(1, rule.type),
    [2, encodeProperties(rule.properties, rule.propertyTypes)],
  ]);
}

function decodeRule(entry: CborValue): RuleConfig {
  const m = requireMap(entry, "rule");
  assertOnlyKeys(m, [0, 1, 2], "rule");
  const props = decodeProperties(m.get(2)!);
  return {
    key: requireU32(m, 0, "rule"),
    type: requireText(m, 1, "rule"),
    properties: props.properties,
    propertyTypes: props.propertyTypes,
  };
}

function encodeBlock(block: BlockConfig): Uint8Array {
  return encodeMap([
    u32Field(0, block.key),
    textField(1, block.type),
    u32Field(2, block.minVersion),
    u32Field(3, block.exactVersion),
    [4, encodeProperties(block.properties, block.propertyTypes)],
  ]);
}

function decodeBlock(entry: CborValue): BlockConfig {
  const m = requireMap(entry, "block");
  assertOnlyKeys(m, [0, 1, 2, 3, 4], "block");
  const props = decodeProperties(m.get(4)!);
  return {
    key: requireU32(m, 0, "block"),
    type: requireText(m, 1, "block"),
    minVersion: requireU32(m, 2, "block"),
    exactVersion: requireU32(m, 3, "block"),
    properties: props.properties,
    propertyTypes: props.propertyTypes,
  };
}

function encodeEdge(edge: EdgeConfig): Uint8Array {
  return encodeMap([
    u32Field(0, edge.sourceKey),
    u32Field(1, edge.sourcePortOrField),
    u32Field(2, edge.targetKey),
    u32Field(3, edge.targetInput),
    u32Field(4, edge.sourceKind),
  ]);
}

function decodeEdge(entry: CborValue): EdgeConfig {
  const m = requireMap(entry, "edge");
  assertOnlyKeys(m, [0, 1, 2, 3, 4], "edge");
  return {
    sourceKey: requireU32(m, 0, "edge"),
    sourcePortOrField: requireU32(m, 1, "edge"),
    targetKey: requireU32(m, 2, "edge"),
    targetInput: requireU32(m, 3, "edge"),
    sourceKind: requireU32(m, 4, "edge"),
  };
}

function encodeMqtt(mqtt: MqttConfig): Uint8Array {
  return encodeMap([
    boolField(0, mqtt.enabled),
    textField(1, mqtt.host),
    u32Field(2, mqtt.port),
    textField(3, mqtt.baseTopic),
    u32Field(4, mqtt.security),
    u32Field(5, mqtt.credentialId),
  ]);
}

function decodeMqtt(value: CborValue): MqttConfig {
  const m = requireMap(value, "mqtt");
  assertOnlyKeys(m, [0, 1, 2, 3, 4, 5], "mqtt");
  return {
    enabled: requireBool(m, 0, "mqtt"),
    host: requireText(m, 1, "mqtt"),
    port: requireU32(m, 2, "mqtt"),
    baseTopic: requireText(m, 3, "mqtt"),
    security: requireU32(m, 4, "mqtt"),
    credentialId: requireU32(m, 5, "mqtt"),
  };
}

function encodeEnergy(energy: EnergyPolicy): Uint8Array {
  return encodeMap([
    u32Field(0, energy.availability),
    u32Field(1, energy.windowMs),
    u32Field(2, energy.periodMs),
  ]);
}

function decodeEnergy(value: CborValue): EnergyPolicy {
  const m = requireMap(value, "energy");
  assertOnlyKeys(m, [0, 1, 2], "energy");
  return {
    availability: requireU32(m, 0, "energy"),
    windowMs: requireU32(m, 1, "energy"),
    periodMs: requireU32(m, 2, "energy"),
  };
}

export function emptySpaghettiConfig(): SpaghettiConfig {
  return {
    version: CONFIG_WIRE_VERSION,
    modules: [],
    schedules: [],
    rules: [],
    blocks: [],
    edges: [],
    connectivityPolicy: 0,
    energyPolicy: { availability: 0, windowMs: 0, periodMs: 0 },
    mqtt: {
      enabled: false,
      host: "",
      port: 1883,
      baseTopic: "spaghetti",
      security: 0,
      credentialId: 0,
    },
  };
}

export function encodeConfig(config: SpaghettiConfig): Uint8Array {
  const version = config.version || CONFIG_WIRE_VERSION;
  return encodeMap([
    u32Field(0, version),
    [1, encodeArray(config.modules.map(encodeModule))],
    [2, encodeArray(config.schedules.map(encodeSchedule))],
    [3, encodeArray(config.rules.map(encodeRule))],
    [4, encodeMqtt(config.mqtt)],
    u32Field(5, config.connectivityPolicy),
    [6, encodeEnergy(config.energyPolicy)],
    [7, encodeArray(config.blocks.map(encodeBlock))],
    [8, encodeArray(config.edges.map(encodeEdge))],
  ]);
}

export function decodeConfig(bytes: Uint8Array): SpaghettiConfig {
  const map = requireMap(decodeOne(bytes), "config");
  assertOnlyKeys(map, [0, 1, 2, 3, 4, 5, 6, 7, 8], "config");
  return {
    version: requireU32(map, 0, "config"),
    modules: requireArray(map, 1, "config").map(decodeModule),
    schedules: requireArray(map, 2, "config").map(decodeSchedule),
    rules: requireArray(map, 3, "config").map(decodeRule),
    mqtt: decodeMqtt(map.get(4)!),
    connectivityPolicy: requireU32(map, 5, "config"),
    energyPolicy: decodeEnergy(map.get(6)!),
    blocks: map.has(7) ? requireArray(map, 7, "config").map(decodeBlock) : [],
    edges: map.has(8) ? requireArray(map, 8, "config").map(decodeEdge) : [],
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

export function decodeGetConfigResponse(bytes: Uint8Array): ConfigSnapshot {
  const map = requireMap(decodeOne(bytes), "GetConfigResponse");
  assertOnlyKeys(map, [0, 1, 2], "GetConfigResponse");
  const sha = requireBytes(map, 1, "GetConfigResponse");
  if (sha.length !== 32) {
    throw new ProtocolCodecError("sha256 must be 32 bytes");
  }
  return {
    revision: {
      generation: requireU32(map, 0, "GetConfigResponse"),
      sha256: sha256Hex(sha),
    },
    config: decodeConfig(requireBytes(map, 2, "GetConfigResponse")),
  };
}

export function encodeGetConfigResponse(snapshot: ConfigSnapshot): Uint8Array {
  return encodeMap([
    u32Field(0, snapshot.revision.generation),
    bytesField(1, hexToBytes(snapshot.revision.sha256)),
    bytesField(2, encodeConfig(snapshot.config)),
  ]);
}

export function encodeValidateConfigRequest(config: SpaghettiConfig): Uint8Array {
  return encodeMap([[0, encodeBytes(encodeConfig(config))]]);
}

export function decodeValidateConfigResponse(bytes: Uint8Array): void {
  const map = requireMap(decodeOne(bytes), "ValidateConfigResponse");
  const valid = requireBool(map, 0, "ValidateConfigResponse");
  if (!valid) {
    const field = requireU32(map, 1, "ValidateConfigResponse");
    const index = requireU32(map, 2, "ValidateConfigResponse");
    const reason = requireU32(map, 3, "ValidateConfigResponse");
    throw new ProtocolCodecError(
      `config validation failed field=${field} index=${index} reason=${reason}`,
    );
  }
}

export function encodeApplyConfigRequest(
  config: SpaghettiConfig,
  expectedGeneration: number,
): Uint8Array {
  return encodeMap([
    u32Field(0, expectedGeneration),
    bytesField(1, encodeConfig(config)),
  ]);
}

export function decodeApplyConfigResponse(bytes: Uint8Array): ApplyResult {
  const map = requireMap(decodeOne(bytes), "ApplyConfigResponse");
  assertOnlyKeys(map, [0, 1, 2], "ApplyConfigResponse");
  const sha = requireBytes(map, 2, "ApplyConfigResponse");
  if (sha.length !== 32) {
    throw new ProtocolCodecError("sha256 must be 32 bytes");
  }
  return {
    changed: requireBool(map, 0, "ApplyConfigResponse"),
    revision: {
      generation: requireU32(map, 1, "ApplyConfigResponse"),
      sha256: sha256Hex(sha),
    },
  };
}

export function encodeApplyConfigResponse(result: ApplyResult): Uint8Array {
  return encodeMap([
    boolField(0, result.changed),
    u32Field(1, result.revision.generation),
    bytesField(2, hexToBytes(result.revision.sha256)),
  ]);
}

function decodeModuleStatus(entry: CborValue): ModuleStatus {
  const m = requireMap(entry, "ModuleStatus");
  return {
    key: requireU32(m, 0, "ModuleStatus"),
    id: requireU32(m, 1, "ModuleStatus"),
    portId: requireU32(m, 2, "ModuleStatus"),
    state: requireU32(m, 3, "ModuleStatus"),
    endpointKind: requireU32(m, 4, "ModuleStatus"),
    endpointValueRaw: requireU32(m, 5, "ModuleStatus"),
    typeId: requireText(m, 6, "ModuleStatus"),
  };
}

export function decodeGetStatusResponse(bytes: Uint8Array): CoreStatus {
  if (bytes.length === 0) {
    return {
      state: 0,
      mode: 0,
      imageState: 0,
      activeSlot: 0,
      imageConfirmed: false,
      version: "",
      portCount: 0,
      lastResetCause: 0,
      healthState: 0,
      modules: [],
    };
  }
  const value = decodeOne(bytes);
  if (value.kind !== "map") {
    throw new ProtocolCodecError("GetStatusResponse must be a map");
  }
  const map = value.value;
  return {
    state: requireU32(map, 0, "GetStatusResponse"),
    mode: requireU32(map, 1, "GetStatusResponse"),
    imageState: requireU32(map, 2, "GetStatusResponse"),
    activeSlot: requireU32(map, 3, "GetStatusResponse"),
    imageConfirmed: requireBool(map, 4, "GetStatusResponse"),
    version: requireText(map, 5, "GetStatusResponse"),
    portCount: requireU32(map, 6, "GetStatusResponse"),
    lastResetCause: requireU32(map, 7, "GetStatusResponse"),
    healthState: requireU32(map, 8, "GetStatusResponse"),
    modules: map.has(9)
      ? requireArray(map, 9, "GetStatusResponse").map(decodeModuleStatus)
      : [],
  };
}

export function encodeGetStatusResponse(status: CoreStatus): Uint8Array {
  const modules = status.modules.map((m) =>
    encodeMap([
      u32Field(0, m.key),
      u32Field(1, m.id),
      u32Field(2, m.portId),
      u32Field(3, m.state),
      u32Field(4, m.endpointKind),
      u32Field(5, m.endpointValueRaw),
      textField(6, m.typeId),
    ]),
  );
  return encodeMap([
    u32Field(0, status.state),
    u32Field(1, status.mode),
    u32Field(2, status.imageState),
    u32Field(3, status.activeSlot),
    boolField(4, status.imageConfirmed),
    textField(5, status.version),
    u32Field(6, status.portCount),
    u32Field(7, status.lastResetCause),
    u32Field(8, status.healthState),
    [9, encodeArray(modules)],
  ]);
}

export function encodeGetTopologyRequest(cursor?: number, limit?: number): Uint8Array {
  const pairs: Array<readonly [number, Uint8Array]> = [];
  if (cursor !== undefined) pairs.push(u32Field(0, cursor));
  if (limit !== undefined) pairs.push(u32Field(1, limit));
  return encodeMap(pairs);
}

function railMaskToIds(mask: number): number[] {
  const ids: number[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if ((mask & (1 << bit)) !== 0) ids.push(bit);
  }
  return ids;
}

function decodeRail(entry: CborValue): PowerRail {
  const m = requireMap(entry, "PowerRail");
  const assuranceCode = requireU32(m, 1, "PowerRail");
  return {
    id: requireU32(m, 0, "PowerRail"),
    assurance: RAIL_ASSURANCE[assuranceCode] ?? "unmanaged",
    maxTotalMicroamps: m.has(2) ? requireU32(m, 2, "PowerRail") : undefined,
  };
}

export interface TopologyPage {
  flows: HardwareFlow[];
  powerRails: PowerRail[];
  nextCursor: number;
}

export function decodeTopologyPage(bytes: Uint8Array): TopologyPage {
  const map = requireMap(decodeOne(bytes), "GetTopologyResponse");
  const flowsRaw = requireArray(map, 0, "GetTopologyResponse");
  const powerRails: PowerRail[] = [];
  const railById = new Map<number, PowerRail>();
  const flows: HardwareFlow[] = flowsRaw.map((entry) => {
    const m = requireMap(entry, "HardwareFlow");
    const directionCode = requireU32(m, 2, "HardwareFlow");
    const signalCount = requireU32(m, 3, "HardwareFlow");
    if (signalCount !== 5) {
      throw new ProtocolCodecError(`unexpected signalCount ${signalCount}`);
    }
    const bays = requireArray(m, 4, "HardwareFlow").map((bayEntry) => {
      const b = requireMap(bayEntry, "FunctionBay");
      const rails = requireArray(b, 5, "FunctionBay").map(decodeRail);
      for (const rail of rails) {
        if (!railById.has(rail.id)) {
          railById.set(rail.id, rail);
          powerRails.push(rail);
        }
      }
      return {
        id: requireU32(b, 0, "FunctionBay"),
        ordinalFromField: requireU32(b, 1, "FunctionBay"),
        availablePowerRails: railMaskToIds(requireU32(b, 2, "FunctionBay")),
        moduleKey: requireU32(b, 3, "FunctionBay") || undefined,
        admission: requireU32(b, 4, "FunctionBay"),
      };
    });
    return {
      id: requireU32(m, 0, "HardwareFlow"),
      portId: requireU32(m, 1, "HardwareFlow"),
      direction: FLOW_DIRECTIONS[directionCode] ?? "bidirectional",
      signalCount: 5 as const,
      bays,
    };
  });
  return {
    flows,
    powerRails,
    nextCursor: requireU32(map, 1, "GetTopologyResponse"),
  };
}

export function encodeTopologyPage(page: TopologyPage): Uint8Array {
  const flows = page.flows.map((flow) => {
    const direction = FLOW_DIRECTIONS.indexOf(flow.direction);
    const bays = flow.bays.map((bay) => {
      let mask = 0;
      for (const id of bay.availablePowerRails) mask |= 1 << id;
      const rails = page.powerRails
        .filter((r) => bay.availablePowerRails.includes(r.id))
        .map((r) =>
          encodeMap([
            u32Field(0, r.id),
            u32Field(1, Math.max(0, RAIL_ASSURANCE.indexOf(r.assurance))),
            u32Field(2, r.maxTotalMicroamps ?? 0),
          ]),
        );
      return encodeMap([
        u32Field(0, bay.id),
        u32Field(1, bay.ordinalFromField),
        u32Field(2, mask),
        u32Field(3, bay.moduleKey ?? 0),
        u32Field(4, bay.admission ?? 0),
        [5, encodeArray(rails)],
      ]);
    });
    return encodeMap([
      u32Field(0, flow.id),
      u32Field(1, flow.portId),
      u32Field(2, direction < 0 ? 2 : direction),
      u32Field(3, 5),
      [4, encodeArray(bays)],
    ]);
  });
  return encodeMap([[0, encodeArray(flows)], u32Field(1, page.nextCursor)]);
}

export function encodeModuleCommandRequest(
  key: number,
  commandId: number,
): Uint8Array {
  return encodeMap([u32Field(0, key), u32Field(1, commandId)]);
}

export function encodeRecordEventPayload(fields: {
  sourceKey: number;
  sequence: number;
  schemaId: string;
  schemaVersion: number;
}): Uint8Array {
  return encodeMap([
    u32Field(0, fields.sourceKey),
    u32Field(1, fields.sequence),
    textField(2, fields.schemaId),
    u32Field(3, fields.schemaVersion),
  ]);
}

export function decodeRecordEventPayload(bytes: Uint8Array): {
  sourceKey: number;
  sequence: number;
  schemaId: string;
  schemaVersion: number;
} {
  const map = requireMap(decodeOne(bytes), "record");
  assertOnlyKeys(map, [0, 1, 2, 3], "record");
  return {
    sourceKey: requireU32(map, 0, "record"),
    sequence: requireU32(map, 1, "record"),
    schemaId: requireText(map, 2, "record"),
    schemaVersion: requireU32(map, 3, "record"),
  };
}

export function encodeStatusEventPayload(fields: {
  deviceId: Uint8Array;
  bootId: bigint;
  queueDepth: number;
  dropCount: number;
}): Uint8Array {
  return encodeMap([
    bytesField(0, fields.deviceId),
    int64Field(1, fields.bootId),
    u32Field(2, fields.queueDepth),
    u32Field(3, fields.dropCount),
  ]);
}

export function decodeStatusEventPayload(bytes: Uint8Array): {
  deviceId: Uint8Array;
  bootId: bigint;
  queueDepth: number;
  dropCount: number;
} {
  const map = requireMap(decodeOne(bytes), "statusEvent");
  return {
    deviceId: requireBytes(map, 0, "statusEvent"),
    bootId: requireUint64(map, 1, "statusEvent"),
    queueDepth: requireU32(map, 2, "statusEvent"),
    dropCount: requireU32(map, 3, "statusEvent"),
  };
}

export function encodeInt64Value(value: bigint): Uint8Array {
  return encodeInt(value);
}

export function encodeUint64Value(value: bigint): Uint8Array {
  return encodeUint(value);
}

export function decodeIntegerValue(bytes: Uint8Array): bigint {
  const value = decodeOne(bytes);
  if (value.kind === "uint") return value.value;
  if (value.kind === "int") return value.value;
  throw new ProtocolCodecError("expected integer CBOR value");
}

export function integerJsonRoundTrip(value: bigint): number | string {
  return integerToJson(value);
}

export function parseIntegerJson(value: unknown): bigint {
  return integerFromJson(value);
}

export function normalizeRevision(revision: ConfigRevision): ConfigRevision {
  if (!/^[0-9a-f]{64}$/.test(revision.sha256)) {
    throw new ProtocolCodecError("sha256 must be 64 lowercase hex characters");
  }
  return revision;
}

export type { Operation };
