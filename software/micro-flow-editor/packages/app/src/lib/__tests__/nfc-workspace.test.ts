import { describe, expect, it, vi } from "vitest";
import {
  addLibraryDriver,
  applyLibraryNamesToNfcNodes,
  applyLibraryToScan,
  associateTagInLibrary,
  builtinRelayModule,
  diffTagPresentations,
  GPIO_RELAY_MODEL_ID,
  RELAY_MODULE_TAG_UID,
  type TagScan,
  decodeModuleTag,
  driverRevision,
  emptyNfcLibrary,
  encodeModuleTag,
  mergeBuiltinNfcDrivers,
  nfcDeadline,
  nfcMemoryAntenna,
  nfcPageAntennaCandidates,
  nfcPageNodeCandidates,
  readNfcLibrary,
  recognizedLibraryModule,
  resolveLibraryDriver,
  SimulatedNfcReader,
  tagIsPresent,
  writeAndVerifyTag,
  type ModuleTag,
  type NfcMemoryBridge,
} from "../nfc-workspace.js";
import { createBlankDraft, createI2cGenericExample } from "../device-recipe-draft.js";
import { installNfcDriver, nfcWiring } from "../nfc-installation.js";
import { PHYSICAL_META_KEY } from "../backbone-physical.js";
import type { ProjectV1 } from "@spaghettilab/domain";
const tag: ModuleTag = {
  type: "module",
  name: "Display OLED è pronto",
  modelId: "oled-1",
  unitId: "unit-1",
  driverId: "oled-driver",
  driverVersion: "1",
};
const target = {
  bindingId: "master",
  nodeId: 2,
  antenna: 1,
  expectedUid: "04A2F19B3C6D7C",
};
describe("NFC memory and protected writing", () => {
  it("roundtrips UTF8 within the Type2 user area and rejects overflow", () => {
    const bytes = encodeModuleTag(tag);
    expect(bytes.length).toBe(160);
    expect(decodeModuleTag(bytes)).toEqual({ kind: "module", value: tag });
    expect(() => encodeModuleTag({ ...tag, name: "è".repeat(100) })).toThrow("byte");
  });
  it("rejects corruption, truncation and unknown version", () => {
    const bytes = encodeModuleTag(tag);
    bytes[15] ^= 1;
    expect(decodeModuleTag(bytes).kind).toBe("corrupt");
    expect(decodeModuleTag(encodeModuleTag(tag).slice(0, 20)).kind).toBe("corrupt");
    const future = encodeModuleTag(tag);
    future[4] = 2;
    expect(decodeModuleTag(future).kind).toBe("corrupt");
  });
  it("preserves wrapped legacy SLM1, unknown and blank memories", () => {
    expect(decodeModuleTag(new Uint8Array(160)).kind).toBe("empty");
    expect(
      decodeModuleTag(new TextEncoder().encode("NDEF spaghettilab.com:module SLM1"))
        .kind,
    ).toBe("legacy");
    expect(decodeModuleTag(new TextEncoder().encode("other")).kind).toBe("unknown");
  });
  it("writes the full user memory and verifies readback", async () => {
    const reader = new SimulatedNfcReader();
    reader.presentTag();
    const result = await writeAndVerifyTag(reader, target, tag);
    expect(decodeModuleTag(result.bytes)).toEqual({ kind: "module", value: tag });
  });
  it("does not write a changed, protected, legacy or unsupported tag", async () => {
    const reader = new SimulatedNfcReader();
    reader.presentTag();
    const spy = vi.spyOn(reader, "write");
    reader.uid = "DIFFERENT";
    await expect(writeAndVerifyTag(reader, target, tag)).rejects.toThrow("cambiato");
    reader.uid = target.expectedUid;
    reader.protected = true;
    await expect(writeAndVerifyTag(reader, target, tag)).rejects.toThrow("protetto");
    reader.protected = false;
    reader.bytes.set(new TextEncoder().encode("SLM1"));
    await expect(writeAndVerifyTag(reader, target, tag)).rejects.toThrow("formato");
    expect(spy).not.toHaveBeenCalled();
    const unsupported: NfcMemoryBridge = {
      read: async () => ({
        uid: target.expectedUid,
        family: "unsupported",
        writable: true,
        bytes: new Uint8Array(160),
      }),
      write: spy,
    };
    await expect(writeAndVerifyTag(unsupported, target, tag)).rejects.toThrow(
      "supportato",
    );
    expect(spy).not.toHaveBeenCalled();
  });
  it("rejects removal between read and write and mismatched readback", async () => {
    const reader = new SimulatedNfcReader();
    reader.presentTag();
    const bridge: NfcMemoryBridge = {
      read: (t, s) => reader.read(t, s),
      write: async (t, b, s) => {
        reader.removeTag();
        await reader.write(t, b, s);
      },
    };
    await expect(writeAndVerifyTag(bridge, target, tag)).rejects.toThrow("rimosso");
    reader.presentTag();
    const bad: NfcMemoryBridge = {
      read: (t, s) => reader.read(t, s),
      write: async () => {},
    };
    await expect(writeAndVerifyTag(bad, target, tag)).rejects.toThrow("Verifica");
  });
  it("has a bounded deadline and aborts the bridge", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const work = nfcDeadline((s) => {
      signal = s;
      return new Promise(() => {});
    }, 30);
    const assertion = expect(work).rejects.toThrow("Tempo scaduto");
    await vi.advanceTimersByTimeAsync(31);
    await assertion;
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });
  it("rejects immediately when the caller aborts", async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    const work = nfcDeadline(
      (s) => {
        signal = s;
        return new Promise(() => {});
      },
      8000,
      controller.signal,
    );
    controller.abort();
    await expect(work).rejects.toThrow("interrotta");
    expect(signal?.aborted).toBe(true);
  });
  it("always verifies the complete image after writing", async () => {
    const reader = new SimulatedNfcReader();
    reader.presentTag();
    const spy = vi.spyOn(reader, "read");
    const result = await writeAndVerifyTag(reader, target, tag);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(decodeModuleTag(result.bytes)).toEqual({ kind: "module", value: tag });
  });
  it("retains simulated memory across physical presentations", async () => {
    const reader = new SimulatedNfcReader();
    reader.presentTag();
    await writeAndVerifyTag(reader, target, tag);
    reader.removeTag();
    reader.presentTag();
    expect(
      decodeModuleTag((await reader.read(target, new AbortController().signal)).bytes)
        .kind,
    ).toBe("module");
  });

  it("skips the pre-write read when the last snapshot is still valid", async () => {
    const reader = new SimulatedNfcReader();
    reader.presentTag();
    const already = await reader.read(target, new AbortController().signal);
    const spy = vi.spyOn(reader, "read");
    await writeAndVerifyTag(reader, target, tag, already);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("NFC memory target", () => {
  it("keeps the GET_STATUS antenna, including port 0", () => {
    expect(nfcMemoryAntenna(0)).toBe(0);
    expect(nfcMemoryAntenna(1)).toBe(1);
    expect(nfcMemoryAntenna(2)).toBe(2);
    expect(nfcPageAntennaCandidates(0)).toEqual([]);
  });

  it("keeps the full observed CAN address", () => {
    expect(
      nfcPageNodeCandidates({
        bindingId: "master",
        nodeId: 0xe18030,
        antenna: 1,
        expectedUid: target.expectedUid,
        alternateNodeIds: [1, 0xe18030],
      }),
    ).toEqual([0xe18030]);
  });

  it("skips the automatic node 0 search in exclusive write", () => {
    expect(
      nfcPageNodeCandidates({
        bindingId: "master",
        nodeId: 0xe18030,
        antenna: 1,
        expectedUid: target.expectedUid,
        alternateNodeIds: [1, 0xe18030],
        exclusive: true,
      }),
    ).toEqual([0xe18030]);
  });

  it("treats the same UID as present after the antenna/node is corrected", () => {
    const scan: TagScan = {
      id: "scan",
      at: 0,
      uid: target.expectedUid,
      target: { ...target, nodeId: 0, antenna: 0 },
      reader: "history",
      simulated: false,
      name: "Relay",
      decoded: { kind: "empty" },
      writable: true,
      read: false,
    };
    expect(
      tagIsPresent(
        scan,
        new Set([`real:${target.bindingId}:${0xe18030}:1:${target.expectedUid}`]),
      ),
    ).toBe(true);
  });
});
describe("library association without chip write", () => {
  it("recognizes an explicitly associated relay UID without inventing chip contents", () => {
    const library = associateTagInLibrary(
      mergeBuiltinNfcDrivers(emptyNfcLibrary()),
      RELAY_MODULE_TAG_UID,
      builtinRelayModule(),
    );
    expect(library.units).toContainEqual({
      uid: RELAY_MODULE_TAG_UID,
      modelId: GPIO_RELAY_MODEL_ID,
      unitId: RELAY_MODULE_TAG_UID,
    });
    const scan: TagScan = {
      id: "scan",
      at: 0,
      uid: RELAY_MODULE_TAG_UID,
      target,
      reader: "reader",
      simulated: false,
      name: "Tag rilevato",
      decoded: { kind: "unknown", reason: "memoria non letta" },
      writable: false,
      read: false,
    };
    const decorated = applyLibraryToScan(scan, library);
    expect(decorated.name).toBe("Relè");
    expect(decorated.decoded).toMatchObject({
      kind: "module",
      value: {
        name: "Relè",
        modelId: GPIO_RELAY_MODEL_ID,
        driverId: "gpio-relay",
      },
    });
    expect(
      applyLibraryNamesToNfcNodes(
        [{ portId: 1, label: "Tag NFC", uid: RELAY_MODULE_TAG_UID }],
        library,
      ),
    ).toEqual([{ portId: 1, label: "Relè", uid: RELAY_MODULE_TAG_UID }]);
    expect(recognizedLibraryModule(scan, library)?.driver.id).toBe("gpio-relay");
    expect(
      recognizedLibraryModule({ ...scan, uid: "04DEADBEEF0000" }, library),
    ).toBeUndefined();
  });

  it("associates another UID without changing chip memory", () => {
    const library = associateTagInLibrary(
      mergeBuiltinNfcDrivers(emptyNfcLibrary()),
      "04AABBCCDDEEFF",
      builtinRelayModule(),
    );
    expect(library.units.map((unit) => unit.uid)).toEqual(["0468C102A02190", "04AABBCCDDEEFF"]);
  });
});
describe("global versioned driver library", () => {
  it("keeps revisions and drafts distinct and detects corrupted definitions", () => {
    const draft = { ...createI2cGenericExample(), status: "ready" as const };
    let library = addLibraryDriver(emptyNfcLibrary(), draft);
    expect(
      resolveLibraryDriver(library, draft.id, String(draft.updatedAt)),
    ).toBeDefined();
    const newer = { ...draft, updatedAt: draft.updatedAt + 1, name: "New version" };
    library = addLibraryDriver(library, newer);
    expect(library.drivers).toHaveLength(2);
    expect(
      resolveLibraryDriver(library, draft.id, String(draft.updatedAt))?.draft.name,
    ).toBe(draft.name);
    expect(readNfcLibrary(JSON.stringify(library))).toEqual(library);
    const corrupted = {
      ...library,
      drivers: library.drivers.map((d) => ({
        ...d,
        draft: { ...d.draft, name: "tampered" },
      })),
    };
    expect(readNfcLibrary(JSON.stringify(corrupted)).drivers).toHaveLength(0);
    expect(driverRevision(createBlankDraft("i2c")).ready).toBe(false);
  });
  it("handles unavailable or malformed archives without trusting them", () => {
    expect(readNfcLibrary("invalid")).toEqual(emptyNfcLibrary());
    expect(readNfcLibrary('{"version":2}')).toEqual(emptyNfcLibrary());
  });
});
function project(variant: "v1" | "v2" = "v2"): ProjectV1 {
  return {
    schemaVersion: 1,
    projectId: "project",
    name: "NFC test",
    coreBindings: [
      { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
      { bindingId: "other", expectedDeviceId: "other", connectionProfileId: "usb" },
    ],
    physicalGraphs: [],
    deviceGraphs: [
      { layer: "device-processing", nodes: [], edges: [] },
      { layer: "device-processing", nodes: [], edges: [] },
    ],
    systemAutomationGraph: { layer: "system-automation", nodes: [], edges: [] },
    requiredArtifacts: [],
    deploymentRecords: [],
    deviceProfilePackages: [],
    authoringMetadata: {
      [PHYSICAL_META_KEY]: {
        comment: JSON.stringify({
          drafts: {
            "master:board": {
              applied: true,
              variant,
              modes: variant === "v2" ? [4, 5, 0, 0, 0, 0, 0, 0] : [4, 5, 0, 0],
              name: "Function",
              i2cSpeed: 100000,
              local: true,
            },
          },
          catalog: [],
        }),
      },
    },
  } as unknown as ProjectV1;
}
describe("NFC guided canvas installation", () => {
  const driver = { ...createI2cGenericExample(), status: "ready" as const };
  it("uses confirmed physical variants, pin mappings and explicit power", () => {
    expect(nfcWiring(project("v1"), "master", driver, "5V").lines[0]?.pin).toBe(
      "Pin 2",
    );
    expect(nfcWiring(project("v2"), "master", driver, "3.3V").lines[0]?.pin).toBe("A0");
    expect(() => nfcWiring(project(), "master", driver)).toThrow("alimentazione");
    expect(() => nfcWiring(project(), "other", driver, "3.3V")).toThrow(
      "configurazione fisica",
    );
  });
  it("inserts once in the selected graph; separate units keep separate instances", () => {
    let p = installNfcDriver(project(), "master", "UID-A", driver, "1", "3.3V");
    expect(p.deviceGraphs[0]?.nodes).toHaveLength(1);
    expect(p.deviceGraphs[1]?.nodes).toHaveLength(0);
    const again = installNfcDriver(p, "master", "UID-A", driver, "1", "3.3V");
    expect(again).toBe(p);
    expect(() => installNfcDriver(p, "master", "UID-B", driver, "1", "3.3V")).toThrow(
      "Indirizzo I²C già usato",
    );
    const alternate = {
      ...driver,
      binding: { ...driver.binding, i2c: { ...driver.binding.i2c!, address: "0x49" } },
    };
    p = installNfcDriver(p, "master", "UID-B", alternate, "1", "3.3V");
    expect(p.deviceGraphs[0]?.nodes).toHaveLength(2);
    expect(JSON.stringify(p)).toContain("nfc-UID-B");
  });
});

describe("NFC presentation events", () => {
  const scan: TagScan = {
    id: "scan",
    at: 0,
    uid: target.expectedUid,
    target,
    simulated: false,
    name: "Empty",
    decoded: { kind: "empty" },
    writable: true,
    read: false,
  };
  it("notifies on the first snapshot, suppresses continuous presence, and emits again after removal", () => {
    const first = diffTagPresentations(new Set(), [scan]);
    expect(first.added).toHaveLength(1);
    expect(
      diffTagPresentations(first.present, [{ ...scan, id: "poll-2" }]).added,
    ).toHaveLength(0);
    const removed = diffTagPresentations(first.present, []);
    expect(diffTagPresentations(removed.present, [scan]).added).toHaveLength(1);
  });
  it("keeps antennas and masters separate, and coalesces retransmissions", () => {
    const antenna = { ...scan, target: { ...target, antenna: 2 } };
    const master = { ...scan, target: { ...target, bindingId: "another-master" } };
    expect(
      diffTagPresentations(new Set(), [scan, scan, antenna, master]).added,
    ).toHaveLength(3);
  });
});

it("does not treat the same UID on a different Master as this reader's tag", () => {
  const scan = { target, uid: target.expectedUid, simulated: false };
  expect(
    tagIsPresent(
      scan,
      new Set([
        `real:another-master:${target.nodeId}:${target.antenna}:${target.expectedUid}`,
      ]),
    ),
  ).toBe(false);
});


it("registers the temperature UID without reading tag memory and keeps other associations", () => {
  const existing = associateTagInLibrary(emptyNfcLibrary(), RELAY_MODULE_TAG_UID, builtinRelayModule());
  const library = mergeBuiltinNfcDrivers(existing);
  expect(library.units).toContainEqual(existing.units[0]);
  const scan = { uid: "04:68:C1:02:A0:21:90", decoded: { kind: "unknown" }, name: "Tag rilevato" } as TagScan;
  const recognized = recognizedLibraryModule(scan, library);
  expect(recognized?.scan.name).toBe("DS18B20");
  expect(recognized?.scan.recognition).toBe("library");
  expect(recognized?.driver.draft.temperatureSensorModel).toBe("ds18b20");
  expect(recognized?.driver.ready).toBe(true);
  expect(mergeBuiltinNfcDrivers(library)).toBe(library);
});
