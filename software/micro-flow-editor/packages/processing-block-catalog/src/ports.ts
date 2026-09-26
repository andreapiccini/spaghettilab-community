/**
 * Typed I/O for Device Processing Graph blocks.
 *
 * Compatibility is domain × role (not block names). `activation` is the jolly
 * entry-point signal from Schedule / Event sources: it may feed any input and
 * is specialized to a concrete PortType when the edge is created.
 */

export const SIGNAL_DOMAINS = [
  "digital",
  "analog",
  "power",
  "event",
  "quantity",
  "text",
  "bytes",
  "enum",
  "reference",
  "activation",
] as const;

export type SignalDomain = (typeof SIGNAL_DOMAINS)[number];

export const SIGNAL_ROLES = [
  "comando",
  "misura",
  "trigger",
  "stato",
  "config",
  "diagnostica",
] as const;

export type SignalRole = (typeof SIGNAL_ROLES)[number];

export type PortType = {
  readonly domain: SignalDomain;
  readonly role: SignalRole;
  readonly range?: { readonly min: number; readonly max: number };
  readonly unit?: string;
};

export type BlockPort = {
  /** React Flow handle id (use `"0"` for the primary single port). */
  readonly id: string;
  readonly direction: "in" | "out";
  /** OR of accepted / produced types on this handle. */
  readonly types: readonly PortType[];
  readonly label?: string;
  readonly required?: boolean;
};

/** Role pairs that may connect when domains already match (or out is activation). */
const ROLE_COMPAT: Readonly<Record<SignalRole, ReadonlySet<SignalRole>>> = {
  comando: new Set(["comando", "stato"]),
  misura: new Set(["misura", "comando", "stato"]),
  trigger: new Set(["trigger", "comando"]),
  stato: new Set(["stato", "comando", "misura"]),
  config: new Set(["config"]),
  diagnostica: new Set(["diagnostica", "stato"]),
};

export function portTypeKey(t: PortType): string {
  return `${t.domain}:${t.role}`;
}

export function rolesCompatible(outRole: SignalRole, inRole: SignalRole): boolean {
  return ROLE_COMPAT[outRole]?.has(inRole) === true;
}

/** True when a single out PortType can feed a single in PortType. */
export function portTypesCompatible(outType: PortType, inType: PortType): boolean {
  if (outType.domain === "activation") return true;
  if (outType.domain !== inType.domain) return false;
  return rolesCompatible(outType.role, inType.role);
}

/** True when any out type on the source port matches any in type on the target port. */
export function portsCompatible(outPort: BlockPort, inPort: BlockPort): boolean {
  if (outPort.direction !== "out" || inPort.direction !== "in") return false;
  for (const o of outPort.types) {
    for (const i of inPort.types) {
      if (portTypesCompatible(o, i)) return true;
    }
  }
  return false;
}

/**
 * Prefer a concrete specialization: non-activation out types first, then first
 * matching in type. Used when connecting activation (jolly) or multi-type ports.
 */
export function resolvePortTypes(outPort: BlockPort, inPort: BlockPort): PortType | undefined {
  if (!portsCompatible(outPort, inPort)) return undefined;

  const concreteOut = outPort.types.filter((t) => t.domain !== "activation");
  const preferOut = concreteOut.length > 0 ? concreteOut : outPort.types;

  for (const o of preferOut) {
    for (const i of inPort.types) {
      if (portTypesCompatible(o, i)) {
        // Activation specializes to the target's declared type.
        if (o.domain === "activation") return i;
        return o;
      }
    }
  }
  return inPort.types[0];
}

export function findPort(
  ports: readonly BlockPort[] | undefined,
  handleId: string | null | undefined,
  direction: "in" | "out",
): BlockPort | undefined {
  if (!ports || ports.length === 0) return undefined;
  const id = handleId && handleId.length > 0 ? handleId : "0";
  return ports.find((p) => p.direction === direction && p.id === id) ?? ports.find((p) => p.direction === direction);
}

export function catalogPortsCompatible(
  sourceOutputs: readonly BlockPort[] | undefined,
  targetInputs: readonly BlockPort[] | undefined,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): boolean {
  // Untyped catalog rows stay permissive until ports are declared.
  if (sourceOutputs === undefined && targetInputs === undefined) return true;
  if (sourceOutputs !== undefined && sourceOutputs.length === 0) return false;
  if (targetInputs !== undefined && targetInputs.length === 0) return false;

  const outPort =
    findPort(sourceOutputs, sourceHandle, "out") ??
    (sourceOutputs === undefined ? undefined : sourceOutputs[0]);
  const inPort =
    findPort(targetInputs, targetHandle, "in") ??
    (targetInputs === undefined ? undefined : targetInputs[0]);

  if (sourceOutputs === undefined) {
    // One side typed: allow if the typed side has a matching direction port.
    return targetInputs === undefined || inPort !== undefined || targetInputs.length > 0;
  }
  if (targetInputs === undefined) {
    return outPort !== undefined || sourceOutputs.length > 0;
  }

  if (!outPort || !inPort) return false;
  return portsCompatible(outPort, inPort);
}

/** Helpers for catalog declarations. */
export function outPort(id: string, types: readonly PortType[], label?: string): BlockPort {
  return { id, direction: "out", types, label };
}

export function inPort(id: string, types: readonly PortType[], opts?: { label?: string; required?: boolean }): BlockPort {
  return { id, direction: "in", types, label: opts?.label, required: opts?.required ?? true };
}

export const T = {
  activationTrigger: { domain: "activation", role: "trigger" } satisfies PortType,
  eventTrigger: { domain: "event", role: "trigger" } satisfies PortType,
  digitalComando: { domain: "digital", role: "comando" } satisfies PortType,
  analogComando: { domain: "analog", role: "comando", range: { min: 0, max: 100 } } satisfies PortType,
  digitalMisura: { domain: "digital", role: "misura" } satisfies PortType,
  analogMisura: { domain: "analog", role: "misura", range: { min: 0, max: 100 } } satisfies PortType,
  /** Tensioni / rail di alimentazione (V). */
  powerMisura: { domain: "power", role: "misura", unit: "V", range: { min: 0, max: 60 } } satisfies PortType,
};
