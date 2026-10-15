import type { Instruction } from "./instruction.js";
import type { SampleField } from "./sample-field.js";

/** `SPAGHETTI_DEVICE_PROFILE_ID_SIZE`/`SPAGHETTI_SCHEMA_ID_SIZE` (32) include the terminating NUL — 31 usable bytes. */
export const PROFILE_ID_MAX_LENGTH = 31;
export const SCHEMA_ID_MAX_LENGTH = 31;

/**
 * Authoring-side draft of one Device Profile — mirrors
 * `struct spaghetti_device_profile` (`device_profile.h`) for every field
 * that struct actually has. "Instance Port, Bay, label, and bus address are
 * not part of this object" per that struct's own doc comment — those live
 * on `@spaghettilab/physical-composition-model`'s `ModuleNodeData`
 * (`portId`/`bayId`/`railId`/`endpoint`), never duplicated here.
 *
 * The real struct has exactly three op arrays: `init_ops`, `sample_ops`,
 * `safe_stop_ops` — no separate `event`/`command` op arrays exist, even
 * though the task text and firmware phase 325's design prose mention
 * "evento/command" as a goal. This package models only what the shipped
 * struct has; event/command acquisition plans remain a documented gap, not
 * an invented field (see this package's README).
 */
export type DeviceProfileDraft = {
  /** Immutable long-message templates; wire v3, at most 3072 bytes total. */
  readonly messageData?: readonly number[];
  /** Wire-v2 action slices in the shared sample op pool. IDs are stable command IDs 1..8. */
  readonly actions?: readonly {
    readonly id: number;
    readonly first: number;
    readonly count: number;
  }[];
  readonly profileId: string;
  readonly version: number;
  readonly transport: number;
  /** OR of `PortCapability` bits (`transport.ts`). */
  readonly requiredCapabilities: number;
  /** Declared worst-case budget the profile must stay within — checked against the computed budget by `validate-profile.ts`. */
  readonly maxTotalTimeMs: number;
  readonly maxTransactions: number;
  readonly maxBytes: number;
  readonly initOps: readonly Instruction[];
  readonly sampleOps: readonly Instruction[];
  readonly safeStopOps: readonly Instruction[];
  readonly sampleSchemaId: string;
  readonly sampleSchemaVersion: number;
  readonly sampleFields: readonly SampleField[];
};
