import type { ProtocolStatus } from "./types.js";

export class ProtocolError extends Error {
  readonly status: ProtocolStatus;
  readonly correlationId?: number;

  constructor(status: ProtocolStatus, message?: string, correlationId?: number) {
    super(message ?? status);
    this.name = "ProtocolError";
    this.status = status;
    this.correlationId = correlationId;
  }
}

export class ProtocolTimeoutError extends ProtocolError {
  constructor(correlationId?: number) {
    super("timeout", "request timed out", correlationId);
    this.name = "ProtocolTimeoutError";
  }
}

export class ProtocolConflictError extends ProtocolError {
  constructor(message = "conflict", correlationId?: number) {
    super("conflict", message, correlationId);
    this.name = "ProtocolConflictError";
  }
}
