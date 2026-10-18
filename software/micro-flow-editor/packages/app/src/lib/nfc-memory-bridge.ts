import { type SpaghettiClient } from "@spaghettilab/protocol-sdk";
import {
  type NfcMemoryBridge,
  type NfcMemory,
  type NfcTarget,
} from "./nfc-workspace.js";

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
    // Use the reader that actually observed this UID. Never probe another Master,
    // broadcast node or antenna, and never cache routes globally by UID.
    const uid = Uint8Array.from(target.expectedUid.match(/../g)!, (byte) =>
      parseInt(byte, 16),
    );
    return client.nfcPage(
      {
        nodeId: target.nodeId,
        antenna: target.antenna,
        uid,
        page,
        ...(data ? { data } : {}),
      },
      signal,
    );
  };
  const read = async (target: NfcTarget, signal: AbortSignal): Promise<NfcMemory> => {
    const cc = await page(target, 3, signal);
    const product = await page(target, 45, signal);
    if (cc[0] !== 0xe1 || cc[2] !== 20 || product[0] !== 0x90 || product[1] !== 0x90)
      return {
        uid: target.expectedUid,
        family: "unsupported",
        writable: false,
        bytes: new Uint8Array(),
      };
    const bytes = new Uint8Array(160);
    for (let i = 0; i < 40; i++) bytes.set(await page(target, i + 4, signal), i * 4);
    return {
      uid: target.expectedUid,
      family: "ST25TN01K",
      writable: (cc[3]! & 15) === 0,
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
