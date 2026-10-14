import { decodeOne } from "../cbor.js";
import { Operation, ProtocolStatus } from "../envelope.js";

export type ConfigApplyFailure = {
  readonly errno: number;
  readonly phase: string;
  readonly rollbackErrno: number;
};

/** Optional APPLY_CONFIG diagnostics; older firmware sends an empty payload. */
export function decodeConfigApplyFailure(
  payload: Uint8Array,
): ConfigApplyFailure | undefined {
  try {
    const value = decodeOne(payload);
    if (value.kind !== "map") return undefined;
    const errno = value.value.get(0);
    const phase = value.value.get(1);
    const rollback = value.value.get(2);
    if (
      errno?.kind !== "int" ||
      errno.value < -2147483648n ||
      phase?.kind !== "text" ||
      !phase.value ||
      (rollback?.kind !== "int" && rollback?.kind !== "uint") ||
      rollback.value < -2147483648n ||
      rollback.value > 2147483647n
    )
      return undefined;
    return {
      errno: Number(errno.value),
      phase: phase.value,
      rollbackErrno: Number(rollback.value),
    };
  } catch {
    return undefined;
  }
}

export type SpaghettiClientErrorCode =
  | "TIMEOUT"
  | "CANCELLED"
  | "CORRELATION_CONFLICT"
  | "REBOOT_DURING_REQUEST"
  | "PROTOCOL_ERROR";

export type SpaghettiClientErrorInit = {
  readonly code: SpaghettiClientErrorCode;
  readonly operation?: Operation;
  readonly correlationId?: number;
  /** Set only for `code: "PROTOCOL_ERROR"` — the status the Core actually returned. */
  readonly status?: ProtocolStatus;
  readonly configFailure?: ConfigApplyFailure;
};

/**
 * Every failure `SpaghettiClient` can produce, distinguished by `code` so a
 * caller never has to string-match a message. `PROTOCOL_ERROR` wraps a real
 * `ProtocolStatus` the Core returned (S021's `envelope.ts`); the other codes
 * are client-side conditions the Core never reports directly (a local
 * deadline, a cancelled `AbortSignal`, an exhausted correlation ID space, or
 * a detected reboot invalidating an in-flight request's replay safety — see
 * `spaghetti-client.ts`).
 */
export class SpaghettiClientError extends Error {
  readonly code: SpaghettiClientErrorCode;
  readonly operation?: Operation;
  readonly correlationId?: number;
  readonly status?: ProtocolStatus;
  readonly configFailure?: ConfigApplyFailure;

  constructor(init: SpaghettiClientErrorInit) {
    const statusLabel =
      init.status !== undefined ? ProtocolStatus[init.status] : undefined;
    super(
      `SpaghettiClient ${init.code}` +
        (init.operation !== undefined
          ? ` (operation ${Operation[init.operation] ?? init.operation})`
          : "") +
        (statusLabel ? ` (status ${statusLabel})` : "") +
        (init.configFailure
          ? ` (phase ${init.configFailure.phase}, errno ${init.configFailure.errno}, rollback ${init.configFailure.rollbackErrno})`
          : ""),
    );
    this.name = "SpaghettiClientError";
    this.code = init.code;
    this.operation = init.operation;
    this.correlationId = init.correlationId;
    this.status = init.status;
    this.configFailure = init.configFailure;
  }
}
