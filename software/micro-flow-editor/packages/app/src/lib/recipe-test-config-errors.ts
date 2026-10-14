/** Firmware `spaghetti_config_failure_field` / `_reason` labels for VALIDATE_CONFIG. */

const FAILURE_FIELD: Record<number, string> = {
  0: "root",
  1: "module",
  2: "schedule",
  3: "rule",
  4: "block",
  5: "edge",
  6: "connectivity",
  7: "energy",
  8: "mqtt",
};

const FAILURE_REASON: Record<number, string> = {
  0: "required",
  1: "range",
  2: "duplicate",
  3: "unknown_type",
  4: "inconsistent",
};

export function formatValidateConfigFailure(failure: {
  readonly failureField: number;
  readonly failureIndex: number;
  readonly failureReason: number;
}): string {
  const field = FAILURE_FIELD[failure.failureField] ?? `field=${failure.failureField}`;
  const reason = FAILURE_REASON[failure.failureReason] ?? `reason=${failure.failureReason}`;
  return `${field}[${failure.failureIndex}]: ${reason}`;
}
