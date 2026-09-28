/**
 * Mirrors `struct spaghetti_config` and its wire-V3 CBOR encoding
 * (`firmware/backbone/subsys/config/config_cbor.c`'s
 * `spaghetti_config_encode_cbor`/`decode_wire_v3`) field for field — not
 * derived from the task prose. `SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V3` is 4,
 * distinct from the in-memory `SPAGHETTI_CONFIG_VERSION` (5); `version` here
 * is always the wire value.
 */
export const CONFIG_WIRE_VERSION = 4;

/** A property set keyed by real firmware `field_id` (numeric) — `encode_properties` insertion-sorts by `field_id` ascending before emitting, which `config-cbor.ts` replicates exactly for byte-reproducible hashes. */
export type PropertyValue = boolean | bigint | string;
export type PropertySet = Readonly<Record<number, PropertyValue>>;

export type CanonicalModule = {
  readonly key: number;
  readonly portId: number;
  readonly typeId: string;
  readonly properties: PropertySet;
  readonly bayId?: number;
  readonly powerRailId?: number;
};

export type CanonicalSchedule = {
  readonly sourceKey: number;
  readonly periodMs: number;
  readonly enabled: boolean;
};

export type CanonicalRule = {
  readonly key: number;
  readonly typeId: string;
  readonly properties: PropertySet;
};

export type CanonicalBlock = {
  readonly key: number;
  readonly typeId: string;
  readonly minVersion: number;
  readonly exactVersion: number;
  readonly properties: PropertySet;
};

export const EdgeSourceKind = { MODULE: 0, BLOCK: 1 } as const;

export type CanonicalEdge = {
  readonly sourceKey: number;
  readonly sourcePortOrField: number;
  readonly targetKey: number;
  readonly targetInput: number;
  readonly sourceKind: (typeof EdgeSourceKind)[keyof typeof EdgeSourceKind];
};

export type CanonicalMqtt = {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly baseTopic: string;
  readonly security: number;
  readonly credentialId: number;
};

export type CanonicalEnergy = {
  readonly bleAvailability: number;
  readonly advertisingWindowMs: number;
  readonly advertisingPeriodMs: number;
};

export type CanonicalConfig = {
  readonly version: typeof CONFIG_WIRE_VERSION;
  readonly modules: readonly CanonicalModule[];
  readonly schedules: readonly CanonicalSchedule[];
  readonly rules: readonly CanonicalRule[];
  readonly mqtt: CanonicalMqtt;
  readonly connectivity: number;
  readonly energy: CanonicalEnergy;
  readonly blocks: readonly CanonicalBlock[];
  readonly edges: readonly CanonicalEdge[];
};
