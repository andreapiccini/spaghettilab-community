import {
  decodeCatalogPage,
  encodeGetCatalogRequest,
  mergeCatalogPages,
  type CatalogPage,
} from "./catalog.js";
import {
  decodeApplyConfigResponse,
  decodeEvent,
  decodeGetConfigResponse,
  decodeGetStatusResponse,
  decodeResponse,
  decodeStatusEventPayload,
  decodeTopologyPage,
  decodeValidateConfigResponse,
  encodeApplyConfigRequest,
  encodeEmptyPayload,
  encodeGetTopologyRequest,
  encodeModuleCommandRequest,
  encodeRequest,
  encodeValidateConfigRequest,
  type EventEnvelope,
} from "./config-codec.js";
import { ProtocolConflictError, ProtocolError, ProtocolTimeoutError } from "./errors.js";
import type { ProtocolTransport } from "./transport.js";
import type {
  ApplyResult,
  Catalog,
  ClientOptions,
  ConfigSnapshot,
  CoreStatus,
  CoreTopology,
  PropertyValues,
  SpaghettiConfig,
} from "./types.js";
import { EventType, Operation } from "./types.js";
const NO_RETRY_STATUSES = new Set([
  "conflict",
  "unauthorized",
  "invalid_argument",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Transport-independent Protocol V1 client.
 *
 * Owns correlation IDs, timeout/retry, catalog pagination/cache, and topology
 * pagination. Retries reuse the exact request bytes and correlation ID.
 * Statuses `conflict`, `unauthorized`, and `invalid_argument` are never
 * auto-retried. After reconnect, retries are allowed only while `boot_id` is
 * unchanged and within the declared replay window. A new boot clears pending
 * work and refuses automatic replay of mutations.
 */
export class SpaghettiClient {
  private nextCorrelationId = 0;
  private catalogCache: Catalog | null = null;
  private bootId: bigint | null = null;
  private replayWindowMs: number;
  private closed = false;
  private readonly recentRequests = new Map<
    number,
    { bytes: Uint8Array; sentAt: number; operation: Operation }
  >();

  constructor(
    private readonly transport: ProtocolTransport,
    private readonly options: ClientOptions = {},
  ) {
    this.replayWindowMs = options.replayWindowMs ?? 5_000;
    void this.pumpEvents();
  }

  async getCatalog(forceRefresh = false): Promise<Catalog> {
    if (!forceRefresh && this.catalogCache) {
      return this.catalogCache;
    }
    for (;;) {
      const pages: CatalogPage[] = [];
      let cursor = 0;
      let fingerprint: string | null = null;
      let restart = false;
      for (;;) {
        const payload = encodeGetCatalogRequest(cursor, 8);
        const response = await this.call(Operation.GET_CATALOG, payload);
        const page = decodeCatalogPage(response);
        if (fingerprint === null) {
          fingerprint = page.fingerprint;
        } else if (page.fingerprint !== fingerprint) {
          this.catalogCache = null;
          restart = true;
          break;
        }
        pages.push(page);
        if (page.nextCursor === 0) break;
        cursor = page.nextCursor;
      }
      if (restart) continue;
      const catalog = mergeCatalogPages(pages);
      if (this.catalogCache && this.catalogCache.fingerprint !== catalog.fingerprint) {
        this.catalogCache = null;
      }
      this.catalogCache = catalog;
      return catalog;
    }
  }

  async getStatus(): Promise<CoreStatus> {
    const payload = await this.call(Operation.GET_STATUS, encodeEmptyPayload());
    const status = decodeGetStatusResponse(payload);
    if (status.bootId !== undefined) {
      this.observeBootId(status.bootId);
    }
    return status;
  }

  async getTopology(): Promise<CoreTopology> {
    const flows = [];
    const powerRails = [];
    const seenRails = new Set<number>();
    let cursor = 0;
    for (;;) {
      const payload = encodeGetTopologyRequest(cursor, 2);
      const response = await this.call(Operation.GET_TOPOLOGY, payload);
      const page = decodeTopologyPage(response);
      flows.push(...page.flows);
      for (const rail of page.powerRails) {
        if (!seenRails.has(rail.id)) {
          seenRails.add(rail.id);
          powerRails.push(rail);
        }
      }
      if (page.nextCursor === 0) break;
      cursor = page.nextCursor;
    }
    return { flows, powerRails };
  }

  async getConfig(): Promise<ConfigSnapshot> {
    const payload = await this.call(Operation.GET_CONFIG, encodeEmptyPayload());
    return decodeGetConfigResponse(payload);
  }

  async validateConfig(config: SpaghettiConfig): Promise<void> {
    const payload = encodeValidateConfigRequest(config);
    const response = await this.call(Operation.VALIDATE_CONFIG, payload);
    decodeValidateConfigResponse(response);
  }

  async applyConfig(
    config: SpaghettiConfig,
    expectedGeneration: number,
  ): Promise<ApplyResult> {
    const payload = encodeApplyConfigRequest(config, expectedGeneration);
    const response = await this.call(Operation.APPLY_CONFIG, payload);
    return decodeApplyConfigResponse(response);
  }

  async moduleCommand(
    key: number,
    command: string,
    _arguments: PropertyValues = {},
  ): Promise<void> {
    void _arguments;
    const catalog = await this.getCatalog();
    let commandId = Number.parseInt(command, 10);
    if (!Number.isFinite(commandId)) {
      commandId = -1;
      for (const driver of catalog.drivers) {
        const found = driver.commands.find((c) => c.name === command);
        if (found) {
          commandId = found.commandId;
          break;
        }
      }
      if (commandId < 0) {
        // Fall back: treat unknown names as command id 1 for host stubs / fakes.
        commandId = 1;
      }
    }
    const payload = encodeModuleCommandRequest(key, commandId);
    await this.call(Operation.MODULE_COMMAND, payload);
  }

  /** Invalidate catalog cache (e.g. retained catalog fingerprint event). */
  invalidateCatalog(fingerprint?: string): void {
    if (
      fingerprint === undefined ||
      (this.catalogCache && this.catalogCache.fingerprint !== fingerprint)
    ) {
      this.catalogCache = null;
    }
  }

  observeBootId(bootId: bigint): void {
    if (this.bootId !== null && this.bootId !== bootId) {
      this.catalogCache = null;
      this.recentRequests.clear();
    }
    this.bootId = bootId;
  }

  getBootId(): bigint | null {
    return this.bootId;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.transport.close();
  }

  private async pumpEvents(): Promise<void> {
    try {
      for await (const bytes of this.transport.events()) {
        if (this.closed) break;
        let event: EventEnvelope;
        try {
          event = decodeEvent(bytes);
        } catch {
          continue;
        }
        if (event.type !== EventType.STATUS) continue;
        try {
          const status = decodeStatusEventPayload(event.payload);
          this.observeBootId(status.bootId);
        } catch {
          // ignore malformed status events
        }
      }
    } catch {
      // transport closed
    }
  }

  private allocateCorrelationId(): number {
    for (let i = 0; i < 0xffffffff; i++) {
      this.nextCorrelationId =
        this.nextCorrelationId === 0xffffffff ? 1 : this.nextCorrelationId + 1;
      if (this.nextCorrelationId === 0) this.nextCorrelationId = 1;
      if (!this.recentRequests.has(this.nextCorrelationId)) {
        return this.nextCorrelationId;
      }
    }
    throw new ProtocolError("resource_exhausted", "correlation id space exhausted");
  }

  private async call(operation: Operation, payload: Uint8Array): Promise<Uint8Array> {
    if (this.closed) {
      throw new ProtocolError("unavailable", "client is closed");
    }
    const correlationId = this.allocateCorrelationId();
    const requestBytes = encodeRequest({ correlationId, operation, payload });
    const timeoutMs = this.options.defaultTimeoutMs ?? 5_000;
    const maxRetries = this.options.maxRetries ?? 2;
    const retryDelayMs = this.options.retryDelayMs ?? 100;
    const sentAt = Date.now();
    this.recentRequests.set(correlationId, { bytes: requestBytes, sentAt, operation });

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (this.bootId !== null) {
        const age = Date.now() - sentAt;
        if (age > this.replayWindowMs && attempt > 0) {
          throw new ProtocolError(
            "unavailable",
            "replay window expired; refusing automatic retry after reconnect",
            correlationId,
          );
        }
      }
      try {
        const responseBytes = await this.transport.send(requestBytes, timeoutMs);
        const response = decodeResponse(responseBytes);
        if (response.correlationId !== correlationId) {
          // Duplicate / unrelated response — ignore and keep waiting via retry path.
          if (attempt < maxRetries) {
            await sleep(retryDelayMs);
            continue;
          }
          throw new ProtocolError(
            "internal_error",
            `unexpected correlation ${response.correlationId}`,
            correlationId,
          );
        }
        if (response.status !== "ok") {
          if (NO_RETRY_STATUSES.has(response.status)) {
            if (response.status === "conflict") {
              throw new ProtocolConflictError("protocol conflict", correlationId);
            }
            throw new ProtocolError(response.status, response.status, correlationId);
          }
          if (attempt < maxRetries) {
            await sleep(retryDelayMs);
            // Same bytes + same correlation — never re-encode.
            if (!bytesEqual(requestBytes, this.recentRequests.get(correlationId)!.bytes)) {
              throw new ProtocolError("internal_error", "request bytes mutated");
            }
            continue;
          }
          throw new ProtocolError(response.status, response.status, correlationId);
        }
        this.recentRequests.delete(correlationId);
        return response.payload;
      } catch (error) {
        lastError = error;
        if (error instanceof ProtocolError && NO_RETRY_STATUSES.has(error.status)) {
          this.recentRequests.delete(correlationId);
          throw error;
        }
        if (
          error instanceof ProtocolTimeoutError ||
          (error instanceof Error && /timeout/i.test(error.message))
        ) {
          if (attempt < maxRetries) {
            await sleep(retryDelayMs);
            continue;
          }
          this.recentRequests.delete(correlationId);
          throw new ProtocolTimeoutError(correlationId);
        }
        if (attempt < maxRetries) {
          await sleep(retryDelayMs);
          continue;
        }
      }
    }
    this.recentRequests.delete(correlationId);
    if (lastError instanceof Error) throw lastError;
    throw new ProtocolTimeoutError(correlationId);
  }
}
