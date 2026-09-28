import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bytesToUuid,
  crc32c,
  decodeUserMemory,
  encodePayload,
  encodeUserMemory,
  emptyFields,
  FactoryFlags,
  FallbackClass,
  fromHex,
  hex,
  MAGIC,
  NDEF_ENVELOPE,
  planFactoryLock,
  planFactoryProgram,
  planInstallationUpdate,
  factoryLockLeavesMutableWritable,
  executeWritePlan,
  uuidToBytes,
  manufacturingDateFromIso,
  definitionHashFromJson,
  canonicalizeJson,
} from "../index.js";

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/golden");

const INSTANCE = uuidToBytes("550e8400-e29b-41d4-a716-446655440000");
const INSTALL = uuidToBytes("6ba7b810-9dad-11d1-80b4-00c04fd430c8");

function sampleFields() {
  const fields = emptyFields();
  fields.factoryFlags = FactoryFlags.HAS_DEFINITION_HASH | FactoryFlags.HAS_FALLBACK_SUMMARY | FactoryFlags.PRODUCTION_UNIT;
  fields.registryId = 1;
  fields.vendorId = 1;
  fields.moduleTypeId = 1001;
  fields.definitionRevision = 3;
  fields.hardwareRevision = 2;
  fields.moduleInstanceId = INSTANCE;
  fields.definitionHash = fromHex("0123456789abcdef0123456789abcdef");
  fields.serialNumber = 4812n;
  fields.manufacturingLot = 7;
  fields.manufacturingDate = manufacturingDateFromIso("2026-09-28");
  fields.fallbackClass = FallbackClass.Backbone;
  fields.fallbackFlags = 0x0105; // power + wired
  fields.installationId = INSTALL;
  fields.roleId = 1001;
  fields.configRevision = 1;
  fields.userFlags = 0;
  return fields;
}

class RamTag {
  pages = new Map<number, Uint8Array>();
  constructor() {
    for (let p = 0; p < 64; p++) this.pages.set(p, new Uint8Array(4));
    // CC ST25TN01K
    this.pages.set(3, Uint8Array.of(0xe1, 0x10, 0x14, 0x00));
    // Product code 0x9090 little-endian in chip map as used by core_util
    this.pages.set(45, Uint8Array.of(0x90, 0x90, 0x01, 0x00));
  }
  async readPage(page: number) {
    return new Uint8Array(this.pages.get(page)!);
  }
  async writePage(page: number, data: Uint8Array) {
    this.pages.set(page, new Uint8Array(data));
  }
  loadUser(user: Uint8Array) {
    for (let i = 0; i < 40; i++) {
      this.pages.set(4 + i, user.slice(i * 4, i * 4 + 4));
    }
  }
}

describe("golden SLM1 codec", () => {
  it("NDEF envelope matches protocol table", () => {
    expect(hex(NDEF_ENVELOPE)).toBe("039ad417807370616768657474696c61622e636f6d3a6d6f64756c65");
    expect(hex(MAGIC)).toBe("534c4d31");
  });

  it("encodes and decodes round trip", () => {
    const fields = sampleFields();
    const user = encodeUserMemory(fields);
    expect(user.length).toBe(160);
    expect(user.slice(0, 28)).toEqual(NDEF_ENVELOPE);
    expect(user.slice(156)).toEqual(Uint8Array.of(0xfe, 0, 0, 0));
    const decoded = decodeUserMemory(user);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.fields.registryId).toBe(1);
    expect(decoded.fields.moduleTypeId).toBe(1001);
    expect(bytesToUuid(decoded.fields.moduleInstanceId)).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(decoded.fields.serialNumber).toBe(4812n);
    expect(hex(decoded.payload.slice(0, 4))).toBe("534c4d31");
  });

  it("detects factory CRC corruption", () => {
    const user = encodeUserMemory(sampleFields());
    // Flip first factory CRC byte at payload offset 0x58 (user offset 28+0x58).
    user[28 + 0x58]! ^= 0xff;
    const decoded = decodeUserMemory(user);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.code).toBe("bad_factory_crc");
  });

  it("rejects bad magic", () => {
    const user = encodeUserMemory(sampleFields());
    user[28] = 0x00;
    const decoded = decodeUserMemory(user);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.code).toBe("bad_magic");
  });

  it("keeps deterministic payload CRC", () => {
    const payload = encodePayload(sampleFields());
    const stored =
      ((payload[0x58]! << 24) | (payload[0x59]! << 16) | (payload[0x5a]! << 8) | payload[0x5b]!) >>> 0;
    expect(crc32c(payload.subarray(0, 0x58))).toBe(stored);
  });

  it("matches checked-in golden fixtures", () => {
    const fields = sampleFields();
    const payload = encodePayload(fields);
    const user = encodeUserMemory(fields);
    expect(hex(NDEF_ENVELOPE)).toBe(readFileSync(join(GOLDEN, "ndef-envelope.hex"), "utf8").trim());
    expect(hex(MAGIC)).toBe(readFileSync(join(GOLDEN, "magic.hex"), "utf8").trim());
    expect(hex(payload)).toBe(readFileSync(join(GOLDEN, "payload-128.hex"), "utf8").trim());
    expect(hex(user)).toBe(readFileSync(join(GOLDEN, "user-memory-160.hex"), "utf8").trim());
    const meta = JSON.parse(readFileSync(join(GOLDEN, "meta.json"), "utf8")) as {
      factoryCrcBeHex: string;
      installationCrcBeHex: string;
    };
    expect(hex(payload.subarray(0x58, 0x5c))).toBe(meta.factoryCrcBeHex);
    expect(hex(payload.subarray(0x7c, 0x80))).toBe(meta.installationCrcBeHex);
  });
});

describe("planners and executor", () => {
  it("programs a blank tag with SLM1 commit last", async () => {
    const tag = new RamTag();
    const fields = sampleFields();
    const plan = planFactoryProgram(fields, tag.pages);
    expect(plan.steps.at(-1)?.page).toBe(11);
    expect(hex(plan.steps.at(-1)!.after)).toBe("534c4d31");
    const result = await executeWritePlan(tag, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decoded = decodeUserMemory(result.verifiedUserMemory);
    expect(decoded.ok).toBe(true);
  });

  it("survives simulated power loss before magic commit", async () => {
    const tag = new RamTag();
    const plan = planFactoryProgram(sampleFields(), tag.pages);
    const crashAt = plan.steps.length - 1; // before final magic
    const result = await executeWritePlan(tag, plan, { crashAfterWrites: crashAt });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.partial).toBe(true);
    const page11 = await tag.readPage(11);
    expect(hex(page11)).not.toBe("534c4d31");
  });

  it("updates installation without touching factory pages", async () => {
    const tag = new RamTag();
    const fields = sampleFields();
    await executeWritePlan(tag, planFactoryProgram(fields, tag.pages));
    const beforeFactory = [];
    for (let p = 4; p <= 33; p++) beforeFactory.push(hex(await tag.readPage(p)));
    const plan = planInstallationUpdate(fields, { roleId: 2002 }, tag.pages);
    const result = await executeWritePlan(tag, plan, { requireSt25tn01k: true });
    expect(result.ok).toBe(true);
    for (let p = 4; p <= 33; p++) {
      expect(hex(await tag.readPage(p))).toBe(beforeFactory[p - 4]);
    }
  });

  it("factory lock plan leaves 34-43 writable bits clear", () => {
    const pages = new Map<number, Uint8Array>();
    pages.set(2, Uint8Array.of(0, 0, 0, 0));
    pages.set(44, Uint8Array.of(0, 0, 0, 0));
    const plan = planFactoryLock(pages);
    expect(factoryLockLeavesMutableWritable(plan)).toBe(true);
    expect(plan.steps.every((s) => s.irreversible)).toBe(true);
  });
});

describe("hash helpers", () => {
  it("canonicalizes object keys", () => {
    expect(canonicalizeJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("produces 16-byte definition hash", async () => {
    const hash = await definitionHashFromJson({ identity: { vendor_id: 1, module_type_id: 1001, definition_revision: 3 } });
    expect(hash.length).toBe(16);
  });
});
