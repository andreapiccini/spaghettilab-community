import {
  migrateDraft,
  validateDraftForCreate,
  type DeviceRecipeDraft,
} from "./device-recipe-draft.js";
import { catalogGpioRelayDriver } from "./gpio-driver-presets.js";

/** App/firmware contract. A bridge must abort on cancellation, serialize each antenna,
 * check expectedUid before EVERY page write and expose user memory only (pages 4–43).
 * No production opcode is invented here: the firmware integration supplies this port. */
export interface NfcMemoryBridge {
  read(target: NfcTarget, signal: AbortSignal): Promise<NfcMemory>;
  write(target: NfcTarget, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
}
export type NfcTarget = {
  bindingId: string;
  nodeId: number;
  antenna: number;
  expectedUid: string;
  /** Other CAN node ids to try when the reported target times out or is rejected. */
  alternateNodeIds?: readonly number[];
  /** Exclusive write: one antenna, few node ids, no long search. */
  exclusive?: boolean;
};

export function nfcPageNodeCandidates(target: NfcTarget): number[] {
  const seen = new Set<number>();
  const small: number[] = [];
  const large: number[] = [];
  const sources = target.exclusive
    ? [...(target.alternateNodeIds ?? []), target.nodeId]
    : [target.nodeId, 0, ...(target.alternateNodeIds ?? [])];
  for (const nodeId of sources) {
    if (!Number.isInteger(nodeId) || nodeId < 0 || nodeId > 0xffffff || seen.has(nodeId)) {
      continue;
    }
    seen.add(nodeId);
    if (nodeId <= 255) small.push(nodeId);
    else large.push(nodeId);
  }
  const ordered = [...small, ...large];
  return target.exclusive ? ordered.slice(0, 2) : ordered;
}

export function nfcPageAntennaCandidates(antenna: number): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const value of [antenna, antenna === 0 ? 1 : 0]) {
    if (!Number.isInteger(value) || value < 0 || value > 2 || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids.length > 0 ? ids : [1];
}
export type NfcMemory = {
  uid: string;
  family: "ST25TN01K" | "unsupported";
  writable: boolean;
  bytes: Uint8Array;
};
export type ModuleTag = {
  type: "module";
  name: string;
  modelId: string;
  unitId: string;
  driverId: string;
  driverVersion: string;
};
export type DecodedTag =
  | { kind: "module"; value: ModuleTag }
  | { kind: "empty" | "legacy" | "unknown" | "corrupt"; reason?: string };
export type TagScan = {
  id: string;
  at: number;
  uid: string;
  reader: string;
  target: NfcTarget;
  simulated: boolean;
  name: string;
  decoded: DecodedTag;
  memory?: number[];
  family?: NfcMemory["family"];
  writable: boolean;
  read: boolean;
  source?: "scan" | "read" | "write";
  imageRef?: string;
};
export const scanPresenceKey = (scan: Pick<TagScan, "target" | "uid" | "simulated">) =>
  `${scan.simulated ? "sim" : "real"}:${scan.target.bindingId}:${scan.target.nodeId}:${scan.target.antenna}:${scan.uid}`;

/** Presence is the UID on a live reader, not the first-seen node/antenna. */
export function tagIsPresent(
  scan: Pick<TagScan, "target" | "uid" | "simulated">,
  presentKeys: ReadonlySet<string>,
): boolean {
  if (presentKeys.has(scanPresenceKey(scan))) return true;
  if (scan.simulated) return false;
  const suffix = `:${scan.uid}`;
  for (const key of presentKeys) {
    if (key.startsWith("real:") && key.endsWith(suffix)) return true;
  }
  return false;
}

/** GET_STATUS portId is the antenna NFC_PAGE should try first. */
export function nfcMemoryAntenna(portId: number): 0 | 1 | 2 {
  if (portId === 2) return 2;
  if (portId === 0) return 0;
  return 1;
}
export function diffTagPresentations(
  previous: ReadonlySet<string>,
  scans: readonly TagScan[],
) {
  const present = new Set<string>();
  const added: TagScan[] = [];
  for (const scan of scans) {
    const key = scanPresenceKey(scan);
    if (!present.has(key) && !previous.has(key)) added.push(scan);
    present.add(key);
  }
  return { present, added };
}
export type LibraryDriver = {
  id: string;
  version: string;
  draft: DeviceRecipeDraft;
  digest: string;
  ready: boolean;
};
export type ModuleDefinition = {
  id: string;
  name: string;
  driverId: string;
  driverVersion: string;
  imageRef?: string;
  voltage?: "3.3V" | "5V";
  origin: "local";
};
export type TagUnit = { uid: string; modelId: string; unitId: string };
export type NfcLibrary = {
  version: 1;
  drivers: LibraryDriver[];
  models: ModuleDefinition[];
  units: TagUnit[];
};
export const NFC_LIBRARY_KEY = "spaghettilab.nfc.library.v1";
export const NFC_HISTORY_KEY = "spaghettilab.nfc.history.v1";
export const NFC_CONTEXT_META = "__nfcDriverContext";
export const NFC_INSTALL_META = "__nfcInstallations";
export const emptyNfcLibrary = (): NfcLibrary => ({
  version: 1,
  drivers: [],
  models: [],
  units: [],
});
export const remoteDriverCatalog = {
  configured: false as const,
  status: "Catalogo online non configurato. Puoi usare o creare un driver locale.",
};

export const GPIO_RELAY_MODEL_ID = "model-gpio-relay";
export const RELAY_MODULE_TAG_UID = "0474C102A02190";

export function normalizeTagUid(uid: string): string {
  return uid.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
}

export function builtinNfcDrivers(): LibraryDriver[] {
  return [driverRevision(catalogGpioRelayDriver())];
}

export function builtinRelayModule(existing?: ModuleDefinition): ModuleDefinition {
  const driver = catalogGpioRelayDriver();
  return {
    id: GPIO_RELAY_MODEL_ID,
    name: driver.name,
    driverId: driver.id,
    driverVersion: String(driver.updatedAt),
    imageRef: existing?.imageRef,
    voltage: existing?.voltage,
    origin: "local",
  };
}

export function associateTagInLibrary(
  library: NfcLibrary,
  uid: string,
  model: ModuleDefinition,
  unitId = uid,
): NfcLibrary {
  const normalized = normalizeTagUid(uid);
  const unit = normalizeTagUid(unitId) || normalized;
  return {
    ...library,
    models: [...library.models.filter((item) => item.id !== model.id), model],
    units: [
      ...library.units.filter((item) => normalizeTagUid(item.uid) !== normalized),
      { uid: normalized, modelId: model.id, unitId: unit },
    ],
  };
}

export function libraryNameForUid(
  library: NfcLibrary,
  uid: string | undefined,
): string | undefined {
  if (!uid) return undefined;
  const normalized = normalizeTagUid(uid);
  const unit = library.units.find((item) => normalizeTagUid(item.uid) === normalized);
  if (!unit) return undefined;
  return library.models.find((item) => item.id === unit.modelId)?.name;
}

export function applyLibraryNamesToNfcNodes<T extends { readonly uid?: string; readonly label: string }>(
  nodes: readonly T[],
  library: NfcLibrary,
): T[] {
  return nodes.map((node) => {
    const name = libraryNameForUid(library, node.uid);
    return name && name !== node.label ? { ...node, label: name } : node;
  });
}

export function recognizedLibraryModule(
  scan: TagScan,
  library: NfcLibrary,
):
  | {
      readonly scan: TagScan;
      readonly driver: LibraryDriver;
      readonly model: ModuleDefinition | undefined;
    }
  | undefined {
  const decorated = applyLibraryToScan(scan, library);
  if (decorated.decoded.kind !== "module") return undefined;
  const value = decorated.decoded.value;
  const driver =
    resolveLibraryDriver(library, value.driverId, value.driverVersion) ??
    resolveLibraryDriver(library, value.driverId);
  if (!driver) return undefined;
  return {
    scan: decorated,
    driver,
    model: library.models.find((item) => item.id === value.modelId),
  };
}

export function applyLibraryToScan(scan: TagScan, library: NfcLibrary): TagScan {
  if (scan.decoded.kind === "module") {
    const model = library.models.find((item) => item.id === scan.decoded.value.modelId);
    return model?.imageRef && !scan.imageRef ? { ...scan, imageRef: model.imageRef } : scan;
  }
  const unit = library.units.find(
    (item) => normalizeTagUid(item.uid) === normalizeTagUid(scan.uid),
  );
  if (!unit) return scan;
  const model = library.models.find((item) => item.id === unit.modelId);
  if (!model) return scan;
  return {
    ...scan,
    name: model.name,
    imageRef: model.imageRef ?? scan.imageRef,
    decoded: {
      kind: "module",
      value: {
        type: "module",
        name: model.name,
        modelId: model.id,
        unitId: unit.unitId,
        driverId: model.driverId,
        driverVersion: model.driverVersion,
      },
    },
  };
}

export function mergeBuiltinNfcDrivers(library: NfcLibrary): NfcLibrary {
  const extras = builtinNfcDrivers().filter(
    (driver) => !library.drivers.some((item) => item.id === driver.id),
  );
  const withDrivers = extras.length
    ? { ...library, drivers: [...library.drivers, ...extras] }
    : library;
  return associateTagInLibrary(
    withDrivers,
    RELAY_MODULE_TAG_UID,
    builtinRelayModule(
      withDrivers.models.find((item) => item.id === GPIO_RELAY_MODEL_ID),
    ),
  );
}

export function checksum(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** SLF1, 160 bytes of Type2 user memory. Header: magic4, version1, type1,
 * payloadLength2, five length-prefixed UTF8 fields, CRC32. Never touches lock/system pages. */
export function encodeModuleTag(value: ModuleTag, capacity = 160): Uint8Array {
  if (!value.name.trim()) throw new Error("Inserisci il nome del modulo.");
  const fields = [
    value.name.trim(),
    value.modelId,
    value.unitId,
    value.driverId,
    value.driverVersion,
  ].map((v) => new TextEncoder().encode(v));
  if (fields.some((v) => v.length > 255))
    throw new Error("Un campo del tag è troppo lungo.");
  const payloadLength = fields.reduce((n, v) => n + 1 + v.length, 0);
  if (payloadLength + 12 > capacity)
    throw new Error(
      `Il contenuto richiede ${payloadLength + 12} byte; il tag ne contiene ${capacity}. Riduci il nome o i riferimenti.`,
    );
  const bytes = new Uint8Array(capacity);
  bytes.set([0x53, 0x4c, 0x46, 0x31, 1, 1]);
  new DataView(bytes.buffer).setUint16(6, payloadLength, true);
  let offset = 8;
  for (const field of fields) {
    bytes[offset++] = field.length;
    bytes.set(field, offset);
    offset += field.length;
  }
  new DataView(bytes.buffer).setUint32(
    offset,
    checksum(bytes.subarray(0, offset)),
    true,
  );
  return bytes;
}
export function decodeModuleTag(bytes: Uint8Array): DecodedTag {
  if (!bytes.length || bytes.every((v) => v === 0 || v === 255))
    return { kind: "empty" };
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  // Legacy SLM1 may be wrapped in an NDEF external record. Keep it read-only.
  if (
    magic === "SLM1" ||
    bytes.some(
      (_, i) =>
        i + 4 <= bytes.length &&
        new TextDecoder().decode(bytes.subarray(i, i + 4)) === "SLM1",
    )
  )
    return {
      kind: "legacy",
      reason:
        "Tag SLM1 esistente: lettura conservata, conversione automatica disabilitata.",
    };
  if (magic !== "SLF1")
    return {
      kind: "unknown",
      reason: "Formato non riconosciuto. La memoria non viene sovrascritta.",
    };
  try {
    if (bytes.length < 12 || bytes[4] !== 1 || bytes[5] !== 1)
      throw new Error("Versione del tag non supportata.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = 8 + view.getUint16(6, true);
    if (
      end + 4 > bytes.length ||
      view.getUint32(end, true) !== checksum(bytes.subarray(0, end))
    )
      throw new Error("Integrità del tag non valida.");
    const fields: string[] = [];
    let offset = 8;
    for (let index = 0; index < 5; index++) {
      if (offset >= end) throw new Error("Tag incompleto.");
      const length = bytes[offset++]!;
      if (offset + length > end) throw new Error("Tag incompleto.");
      fields.push(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(offset, offset + length),
        ),
      );
      offset += length;
    }
    if (offset !== end || !fields[0]?.trim())
      throw new Error("Contenuto del tag non valido.");
    return {
      kind: "module",
      value: {
        type: "module",
        name: fields[0]!,
        modelId: fields[1]!,
        unitId: fields[2]!,
        driverId: fields[3]!,
        driverVersion: fields[4]!,
      },
    };
  } catch (error) {
    return {
      kind: "corrupt",
      reason: error instanceof Error ? error.message : "Tag non valido.",
    };
  }
}
export function driverRevision(draft: DeviceRecipeDraft): LibraryDriver {
  const normalized = migrateDraft(draft);
  const digest = checksum(new TextEncoder().encode(JSON.stringify(normalized)))
    .toString(16)
    .padStart(8, "0");
  return {
    id: draft.id,
    version: String(draft.updatedAt),
    draft: normalized,
    digest,
    ready:
      validateDraftForCreate(normalized).length === 0 && normalized.status === "ready",
  };
}
export function addLibraryDriver(
  library: NfcLibrary,
  draft: DeviceRecipeDraft,
): NfcLibrary {
  const driver = driverRevision(draft);
  return {
    ...library,
    drivers: [
      ...library.drivers.filter(
        (d) => !(d.id === driver.id && d.version === driver.version),
      ),
      driver,
    ],
  };
}
export function resolveLibraryDriver(
  library: NfcLibrary,
  id: string,
  version?: string,
): LibraryDriver | undefined {
  const driver = library.drivers
    .filter((d) => d.id === id && (!version || d.version === version))
    .at(-1);
  if (!driver || !driver.ready || driverRevision(driver.draft).digest !== driver.digest)
    return undefined;
  return driver;
}
export function readNfcLibrary(raw: string | null): NfcLibrary {
  try {
    const parsed = JSON.parse(raw ?? "null") as NfcLibrary;
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.drivers) ||
      !Array.isArray(parsed.models) ||
      !Array.isArray(parsed.units)
    )
      return emptyNfcLibrary();
    return {
      ...parsed,
      drivers: parsed.drivers.filter((d) => {
        try {
          return d.id === d.draft.id && driverRevision(d.draft).digest === d.digest;
        } catch {
          return false;
        }
      }),
      models: parsed.models.filter(
        (m) => typeof m.id === "string" && m.origin === "local",
      ),
      units: parsed.units.filter((u) => typeof u.uid === "string"),
    };
  } catch {
    return emptyNfcLibrary();
  }
}
export async function nfcDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  ms = 8000,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (external?.aborted) {
    abort();
    throw new Error("Scrittura interrotta.");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectRace: ((reason: Error) => void) | undefined;
  const onExternal = () => {
    abort();
    rejectRace?.(new Error("Scrittura interrotta."));
  };
  external?.addEventListener("abort", onExternal, { once: true });
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        rejectRace = reject;
        timer = setTimeout(() => {
          abort();
          reject(new Error("Tempo scaduto. Riavvicina il tag e riprova."));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    external?.removeEventListener("abort", onExternal);
  }
}
export async function writeAndVerifyTag(
  bridge: NfcMemoryBridge,
  target: NfcTarget,
  value: ModuleTag,
  previous?: NfcMemory,
  options?: { readonly deadlineMs?: number; readonly skipPreRead?: boolean; readonly signal?: AbortSignal },
): Promise<NfcMemory> {
  return nfcDeadline(
    async (signal) => {
      const bytes = encodeModuleTag(value, 160);
      if (!options?.skipPreRead) {
        const before =
          previous &&
          previous.uid === target.expectedUid &&
          previous.family === "ST25TN01K" &&
          previous.bytes.length === 160
            ? previous
            : await bridge.read(target, signal);
        if (before.uid !== target.expectedUid)
          throw new Error("Il tag è cambiato. Riavvicina il tag originale.");
        if (before.family !== "ST25TN01K" || before.bytes.length !== 160)
          throw new Error("Questo tipo di tag non è ancora supportato per la scrittura.");
        const decoded = decodeModuleTag(before.bytes);
        if (!before.writable || !["empty", "module"].includes(decoded.kind))
          throw new Error("Tag protetto o formato esistente: scrittura disabilitata.");
      }
      signal.throwIfAborted();
      await bridge.write(target, bytes, signal);
      if (options?.skipPreRead) {
        return {
          uid: target.expectedUid,
          family: "ST25TN01K" as const,
          writable: true,
          bytes,
        };
      }
      signal.throwIfAborted();
      const after = await bridge.read(target, signal);
      if (
        after.uid !== target.expectedUid ||
        after.bytes.length !== bytes.length ||
        !after.bytes.every((byte, index) => byte === bytes[index])
      )
        throw new Error("Verifica non riuscita. Il tag non è stato confermato.");
      return after;
    },
    options?.deadlineMs ?? 90000,
    options?.signal,
  );
}

/** Deterministic, explicit development reader. Retains the tag memory across presentations. */
export class SimulatedNfcReader implements NfcMemoryBridge {
  present = false;
  protected = false;
  uid = "04A2F19B3C6D7C";
  bytes = new Uint8Array(160);
  failure: "none" | "timeout" | "removed" | "changed" = "none";
  presentTag(blank = false) {
    if (blank) {
      this.bytes = new Uint8Array(160);
      this.uid = `04${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    }
    this.present = true;
  }
  restoreTag(uid: string, bytes: readonly number[]) {
    if (
      /^[0-9A-F]{14}$/.test(uid) &&
      bytes.length === 160 &&
      bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
    ) {
      this.uid = uid;
      this.bytes = Uint8Array.from(bytes);
    }
  }
  removeTag() {
    this.present = false;
  }
  setFailure(value: SimulatedNfcReader["failure"]) {
    this.failure = value;
  }
  private check(target: NfcTarget, signal: AbortSignal) {
    if (signal.aborted) throw new Error("Operazione annullata.");
    if (!this.present || this.failure === "removed")
      throw new Error("Tag rimosso. Riavvicinalo al lettore.");
    if (target.expectedUid !== this.uid || this.failure === "changed")
      throw new Error("Il tag è cambiato.");
  }
  async read(target: NfcTarget, signal: AbortSignal): Promise<NfcMemory> {
    this.check(target, signal);
    if (this.failure === "timeout")
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Tempo scaduto.")), {
          once: true,
        }),
      );
    return {
      uid: this.uid,
      family: "ST25TN01K",
      writable: !this.protected,
      bytes: this.bytes.slice(),
    };
  }
  async write(target: NfcTarget, bytes: Uint8Array, signal: AbortSignal) {
    this.check(target, signal);
    if (this.protected) throw new Error("Tag protetto da scrittura.");
    if (bytes.length !== 160) throw new Error("Area utente non valida.");
    this.bytes = bytes.slice();
  }
}
