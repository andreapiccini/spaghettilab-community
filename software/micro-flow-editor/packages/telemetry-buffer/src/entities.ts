/**
 * `RecordEventPayload` (`@spaghettilab/protocol-sdk`'s `EventType.RECORD`) is
 * a **notification only** — `{sourceKey, sequence, schemaId, schemaVersion}`,
 * no field values at all. The real record
 * (`struct spaghetti_record { source_id, source_key, boot_id, timestamp_ms,
 * sequence, payload: {kind, schema_id, schema_version, values} }`,
 * `firmware/backbone/include/spaghetti/schema.h`) is delivered out-of-band per
 * consumer (`spaghetti_record_delivery_peek`/`ack`,
 * `firmware/backbone/include/spaghetti/record_delivery.h` — one bounded ring
 * with independent cursors for the MQTT and BLE consumers) — there is no
 * `GET_RECORD`-style Protocol V1 operation in `protocol-sdk` today, and no
 * MQTT-payload CBOR decoder either. This package therefore cannot decode
 * field values itself; every field value it stores came from a
 * caller-supplied resolver, the same "caller-supplied, not invented"
 * pattern used everywhere else in this codebase for data that isn't really
 * on the wire yet (S021 already recorded schema descriptors are unpopulated
 * on every operation).
 */

/** A property set keyed by real firmware `field_id`, matching `@spaghettilab/config-compiler`'s `PropertySet` shape (never re-exported from there to avoid a hard dependency this package doesn't otherwise need). */
export type TelemetryFieldValue = boolean | bigint | string;
export type TelemetryFields = Readonly<Record<number, TelemetryFieldValue>>;

export type TelemetryProvenance = {
  /** Caller-assigned stable Core identifier (e.g. a `CoreBindingId` or device ID hex) — this package never talks to a transport itself, so it has no independent notion of "which Core" beyond what the caller tags each `EventStream` with. */
  readonly coreId: string;
  readonly sourceKey: number;
  readonly schemaId: string;
  readonly schemaVersion: number;
  /** `undefined` until a `STATUS` event has been observed for this Core — never a fabricated placeholder value. */
  readonly bootId?: bigint;
  /** Increments every time this Core's `boot_id` changes — a visible discontinuity marker on every record, so two records straddling a reboot are never mistaken for one continuous series even without cross-referencing a separate gap log (S091 § Verifiche). */
  readonly bootEpoch: number;
  readonly sequence: number;
};

export type DecodedTelemetryRecord = {
  readonly kind: "decoded";
  readonly provenance: TelemetryProvenance;
  readonly fields: TelemetryFields;
};

/** S091 point 2: "unknown schema conserva payload diagnostico ... senza interpretazione inventata" — `fields` is never guessed at; only `rawPayload` (if the caller had bytes to preserve) survives. */
export type UnknownSchemaTelemetryRecord = {
  readonly kind: "unknown-schema";
  readonly provenance: TelemetryProvenance;
  readonly rawPayload?: Uint8Array;
  readonly needsCatalogRefresh: true;
};

export type TelemetryRecord = DecodedTelemetryRecord | UnknownSchemaTelemetryRecord;

export type TelemetryGap = {
  readonly coreId: string;
  readonly reason: "boot_id_changed" | "sequence_discontinuity";
  readonly detail: string;
  readonly bootEpoch: number;
};

/** Optional domain-context annotation for S091 point 4: "collega errore live al relativo Core/Module/Profile/Block" — caller-supplied because it needs `ProjectV1`/`DeploymentRecord` data this package has no access to. */
export type TelemetryContext = {
  readonly moduleNodeId?: string;
  readonly profileId?: string;
  readonly blockNodeId?: string;
};
