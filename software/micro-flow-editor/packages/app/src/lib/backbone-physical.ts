import {
  decodePhysicalBackbone,
  encodePhysicalSettings,
  type GetStatusResponse,
  type NfcTagStatus,
  type PhysicalBackbone,
  type PhysicalInterfaceSettings,
} from "@spaghettilab/protocol-sdk";
import builtin from "../../../catalog-model/src/nfc-module-catalog.json";
import type { CustomProtocol } from "./port-protocol-mock.js";

export type PhysicalCatalogEntry = {
  readonly registryId: number;
  readonly vendorId: number;
  readonly moduleTypeId: number;
  readonly name: string;
  readonly nameIt?: string;
  /** Complete six-pin electrical definition. Missing in the legacy demo catalog. */
  readonly pins?: readonly string[];
  readonly modes?: readonly number[];
  readonly i2cSpeed?: number;
  readonly protocol?: CustomProtocol;
  readonly settings?: PhysicalInterfaceSettings;
};

export const PHYSICAL_CATALOG: readonly PhysicalCatalogEntry[] = builtin;
export const PHYSICAL_META_KEY = "__backbonePhysical";

export type BackbonePhysicalDraft = {
  readonly applied?: boolean;
  readonly nodeId?: number;
  readonly local?: boolean;
  readonly backendPortId?: number;
  readonly automatic?: boolean;
  readonly name: string;
  readonly modes: readonly number[];
  readonly i2cSpeed: number;
  readonly protocol?: CustomProtocol;
  readonly settings?: PhysicalInterfaceSettings;
};

export function expectedFunctionTag(
  tag: NfcTagStatus | undefined,
  automatic = false,
): Uint8Array {
  const bytes = new Uint8Array(20);
  if (tag) {
    const view = new DataView(bytes.buffer);
    view.setUint16(0, tag.registryId ?? 0);
    view.setUint16(2, tag.vendorId ?? 0);
    view.setUint32(4, tag.moduleTypeId ?? 0);
    if (tag.uid.length > 10) throw new Error("Invalid NFC UID");
    bytes[8] = tag.uid.length;
    bytes.set(tag.uid, 9);
  }
  bytes[19] = automatic ? 1 : 0;
  return bytes;
}

export type PhysicalProject = {
  readonly drafts: Readonly<Record<string, BackbonePhysicalDraft>>;
  readonly catalog: readonly PhysicalCatalogEntry[];
};

export function parsePhysicalProject(raw: string | undefined): PhysicalProject {
  try {
    const parsed = JSON.parse(raw ?? "{}") as Partial<PhysicalProject>;
    return { drafts: parsed.drafts ?? {}, catalog: parsed.catalog ?? [] };
  } catch {
    return { drafts: {}, catalog: [] };
  }
}

export function catalogEntry(
  tag: NfcTagStatus | undefined,
  catalog: readonly PhysicalCatalogEntry[],
): PhysicalCatalogEntry | undefined {
  if (!tag?.registryId || !tag.vendorId || !tag.moduleTypeId) return undefined;
  return catalog.find(
    (entry) =>
      entry.registryId === tag.registryId &&
      entry.vendorId === tag.vendorId &&
      entry.moduleTypeId === tag.moduleTypeId,
  );
}

export function pinsForModes(modes: readonly number[]): string[] {
  return [
    "5V",
    ...modes.map((mode) => {
      const base = mode & 15;
      return base === 4
        ? "SDA"
        : base === 5
          ? "SCL"
          : base === 1
            ? `GPIO IN${mode & 16 ? " · ↑" : mode & 32 ? " · ↓" : ""}`
            : base === 2
              ? "GPIO OUT · 0"
              : base === 3
                ? "GPIO OUT · 1"
                : "NC";
    }),
    "GND",
  ];
}

export function topologyForBoard(
  status: GetStatusResponse | undefined,
  board: { readonly local: boolean; readonly nodeId: number },
): PhysicalBackbone | undefined {
  const bytes = board.local
    ? (status?.physical ?? status?.chainPeers?.find((peer) => peer.local)?.physical)
    : status?.chainPeers?.find((peer) => !peer.local && peer.nodeId === board.nodeId)
        ?.physical;
  return bytes ? decodePhysicalBackbone(bytes) : undefined;
}

export function tagForSlot(
  status: GetStatusResponse | undefined,
  board: { readonly local: boolean; readonly nodeId: number },
  slot: number,
): NfcTagStatus | undefined {
  return status?.nfcTags?.find(
    (tag) =>
      tag.portId === slot &&
      (board.local ? tag.local : !tag.local && tag.nodeId === board.nodeId),
  );
}

export function validatePhysicalModes(
  modes: readonly number[],
  speed: number,
): string | undefined {
  if (
    modes.length !== 4 ||
    modes.some(
      (mode) =>
        !Number.isInteger(mode) ||
        mode < 0 ||
        mode > 255 ||
        (mode & 15) > 12 ||
        (mode & 0xc0) !== 0 ||
        (mode & 0x30) === 0x30 ||
        ((mode & 15) !== 1 && (mode & 0x30) !== 0),
    )
  )
    return "Invalid pin map";
  if (speed !== 0 && speed !== 1) return "Invalid I²C speed";
  const bases = modes.map((mode) => mode & 15);
  for (const group of [
    [4, 5],
    [6, 7],
    [8, 9, 10, 11],
  ]) {
    if (
      bases.some((base) => group.includes(base)) &&
      group.some((base) => bases.filter((value) => value === base).length !== 1)
    )
      return (
        "Assegna una volta tutti i segnali dell’interfaccia: " +
        group.map((base) => pinsForModes([base])[1]).join(", ")
      );
  }
  return undefined;
}

/** Reject incomplete electrical imports; legacy metadata entries remain display-only. */
export function parsePhysicalCatalog(raw: string): readonly PhysicalCatalogEntry[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 256)
    throw new Error("Expected a catalog array (maximum 256 modules)");
  const identities = new Set<string>();
  return parsed.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Invalid catalog entry");
    const entry = value as PhysicalCatalogEntry;
    if (
      ![entry.registryId, entry.vendorId, entry.moduleTypeId].every(
        (id) => Number.isInteger(id) && id > 0,
      ) ||
      entry.registryId > 65535 ||
      entry.vendorId > 65535 ||
      entry.moduleTypeId > 0xffffffff ||
      typeof entry.name !== "string" ||
      !entry.name.trim()
    )
      throw new Error("Missing module identity or name");
    const key = `${entry.registryId}:${entry.vendorId}:${entry.moduleTypeId}`;
    if (identities.has(key)) throw new Error(`Duplicate module ${key}`);
    identities.add(key);
    if (
      entry.pins &&
      (entry.pins.length !== 6 ||
        !entry.pins.every((pin) => typeof pin === "string" && pin.length <= 40))
    )
      throw new Error("Each port must describe exactly six pins");
    if (
      entry.modes &&
      (!entry.pins ||
        validatePhysicalModes(entry.modes, entry.i2cSpeed ?? 0) ||
        entry.pins.some(
          (pin, i) =>
            pin !== pinsForModes(entry.modes!)[i] &&
            !(
              i > 0 &&
              i < 5 &&
              [2, 3].includes(entry.modes![i - 1]!) &&
              ["GPIO OUT · 0", "GPIO OUT · 1"].includes(pin)
            ),
        ))
    )
      throw new Error("Invalid Function port 2 electrical definition");
    if (entry.settings) encodePhysicalSettings(entry.settings);
    return entry;
  });
}
