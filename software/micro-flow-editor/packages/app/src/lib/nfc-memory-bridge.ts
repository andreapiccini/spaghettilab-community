import { ProtocolStatus, SpaghettiClientError, type SpaghettiClient } from "@spaghettilab/protocol-sdk";
import {
  nfcPageAntennaCandidates,
  nfcPageNodeCandidates,
  type NfcMemoryBridge,
  type NfcMemory,
  type NfcTarget,
} from "./nfc-workspace.js";

const workingByUid = new Map<string, { readonly nodeId: number; readonly antenna: number }>();

function isInternalError(error: unknown): boolean {
  return (
    error instanceof SpaghettiClientError &&
    error.code === "PROTOCOL_ERROR" &&
    error.status === ProtocolStatus.INTERNAL_ERROR
  );
}

function isInvalidArgument(error: unknown): boolean {
  return (
    error instanceof SpaghettiClientError &&
    error.code === "PROTOCOL_ERROR" &&
    error.status === ProtocolStatus.INVALID_ARGUMENT
  );
}

function isRetryablePageError(error: unknown): boolean {
  if (!(error instanceof SpaghettiClientError)) return false;
  if (error.code === "TIMEOUT" || error.code === "REBOOT_DURING_REQUEST") return true;
  if (isInternalError(error)) return true;
  return (
    error.code === "PROTOCOL_ERROR" &&
    (error.status === ProtocolStatus.TIMEOUT ||
      error.status === ProtocolStatus.UNAVAILABLE ||
      error.status === ProtocolStatus.BUSY)
  );
}

function isMalformed(error: unknown): boolean {
  return (
    error instanceof SpaghettiClientError &&
    error.code === "PROTOCOL_ERROR" &&
    error.status === ProtocolStatus.MALFORMED_REQUEST
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Every page is bound to the full UID; firmware checks it again at RF selection. */
export function createNfcMemoryBridge(
  getClient: (binding: string) => SpaghettiClient | undefined,
): NfcMemoryBridge {
  const page = async (
    target: NfcTarget,
    page: number,
    signal: AbortSignal,
    data?: Uint8Array,
  ) => {
    signal.throwIfAborted();
    if (!/^[0-9A-Fa-f]{14}$/.test(target.expectedUid))
      throw new Error("Questo tipo di tag NFC non è supportato per la memoria.");
    const client = getClient(target.bindingId);
    if (!client)
      throw new Error("Collega la Backbone master prima di leggere o scrivere il tag.");
    const uid = Uint8Array.from(target.expectedUid.match(/../g)!, (b) =>
      parseInt(b, 16),
    );
    const remembered = workingByUid.get(target.expectedUid);
    const exclusive = Boolean(target.exclusive);
    const nodeIds = nfcPageNodeCandidates({
      ...target,
      nodeId: remembered?.nodeId ?? target.nodeId,
      alternateNodeIds: [
        target.nodeId,
        ...(target.alternateNodeIds ?? []),
        ...(remembered ? [remembered.nodeId] : []),
      ],
    });
    const antennas = exclusive
      ? [remembered?.antenna ?? target.antenna]
      : nfcPageAntennaCandidates(remembered?.antenna ?? target.antenna);
    const small = nodeIds.filter((id) => id <= 255).slice(0, exclusive ? 2 : 3);
    const pairs: Array<readonly [number, number]> = [];
    if (remembered) pairs.push([remembered.nodeId, remembered.antenna]);
    for (const antenna of antennas) {
      for (const nodeId of small) pairs.push([nodeId, antenna]);
    }
    const seen = new Set<string>();
    let lastError: unknown;
    let sawTimeout = false;
    const maxAttempts = exclusive ? 1 : 2;
    for (const [nodeId, antenna] of pairs) {
      const key = `${nodeId}:${antenna}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const result = await client.nfcPage(
            {
              nodeId,
              antenna,
              uid,
              page,
              ...(data ? { data } : {}),
            },
            signal,
          );
          workingByUid.set(target.expectedUid, { nodeId, antenna });
          return result;
        } catch (error) {
          lastError = error;
          if (signal.aborted) throw error;
          if (isMalformed(error) || isInvalidArgument(error)) break;
          if (isInternalError(error)) {
            workingByUid.set(target.expectedUid, { nodeId, antenna });
            if (attempt === 0) {
              await sleep(120);
              continue;
            }
            break;
          }
          if (!isRetryablePageError(error)) throw error;
          sawTimeout = true;
          if (attempt === 0) await sleep(120);
        }
      }
    }
    if (sawTimeout) {
      throw new Error(
        "Il tag è sul lettore, ma il master non riesce a leggerne la memoria. Serve firmware che inoltri NFC_PAGE al lettore CAN.",
      );
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Lettura o scrittura NFC non riuscita.");
  };
  const read = async (target: NfcTarget, signal: AbortSignal): Promise<NfcMemory> => {
    const bytes = new Uint8Array(160);
    for (let i = 0; i < 40; i++) bytes.set(await page(target, i + 4, signal), i * 4);
    return {
      uid: target.expectedUid,
      family: "ST25TN01K",
      writable: true,
      bytes,
    };
  };
  const write = async (target: NfcTarget, bytes: Uint8Array, signal: AbortSignal) => {
    if (bytes.length !== 160 || String.fromCharCode(...bytes.slice(0, 4)) !== "SLF1")
      throw new Error("Contenuto NFC non valido.");
    for (let i = 0; i < 40; i++) {
      const requested = bytes.slice(i * 4, i * 4 + 4);
      const confirmed = await page(target, i + 4, signal, requested);
      if (!requested.every((byte, j) => byte === confirmed[j]))
        throw new Error("Conferma di scrittura NFC non valida.");
    }
  };
  const queues = new Map<string, Promise<unknown>>();
  const serialize = <T>(
    target: NfcTarget,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> => {
    const key = `${target.bindingId}:${target.expectedUid}`;
    const pending = (queues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        signal.throwIfAborted();
        return work();
      });
    queues.set(key, pending);
    void pending
      .finally(() => {
        if (queues.get(key) === pending) queues.delete(key);
      })
      .catch(() => {});
    return pending;
  };
  return {
    read: (target, signal) => serialize(target, signal, () => read(target, signal)),
    write: (target, bytes, signal) =>
      serialize(target, signal, () => write(target, bytes, signal)),
  };
}
