/**
 * Mirrors `struct spaghetti_device_profile_field` (`device_profile.h`).
 * Samples support INT64, UINT64, finite FLOAT and TEXT. EMIT_DECIMAL converts
 * signed 16-bit tenths into degrees at the publishing boundary; integer fields
 * retain their original wire representation.
 */
export type SampleFieldType = "int64" | "uint64" | "float" | "text";

/** `SPAGHETTI_FIELD_NAME_SIZE` (24) includes the terminating NUL — 23 usable bytes. */
export const FIELD_NAME_MAX_LENGTH = 23;
/** `SPAGHETTI_UNIT_NAME_SIZE` (16) includes the terminating NUL — 15 usable bytes. */
export const UNIT_NAME_MAX_LENGTH = 15;

export type SampleField = {
  /** Stable nonzero schema field identifier — 0 is not a valid `fieldId`. */
  readonly fieldId: number;
  readonly type: SampleFieldType;
  readonly name: string;
  readonly unit?: string;
};
