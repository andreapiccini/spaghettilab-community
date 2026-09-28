import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeUserMemory,
  encodePayload,
  emptyFields,
  FactoryFlags,
  FallbackClass,
  fromHex,
  hex,
  uuidToBytes,
  manufacturingDateFromIso,
  NDEF_ENVELOPE,
  MAGIC,
} from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/golden");
mkdirSync(root, { recursive: true });

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
  fields.fallbackFlags = 0x0105;
  fields.installationId = INSTALL;
  fields.roleId = 1001;
  fields.configRevision = 1;
  fields.userFlags = 0;
  return fields;
}

const fields = sampleFields();
const payload = encodePayload(fields);
const user = encodeUserMemory(fields);

writeFileSync(join(root, "ndef-envelope.hex"), hex(NDEF_ENVELOPE) + "\n");
writeFileSync(join(root, "magic.hex"), hex(MAGIC) + "\n");
writeFileSync(join(root, "payload-128.hex"), hex(payload) + "\n");
writeFileSync(join(root, "user-memory-160.hex"), hex(user) + "\n");
writeFileSync(
  join(root, "meta.json"),
  JSON.stringify(
    {
      moduleInstanceId: "550e8400-e29b-41d4-a716-446655440000",
      installationId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      registryId: 1,
      vendorId: 1,
      moduleTypeId: 1001,
      definitionRevision: 3,
      serialNumber: "4812",
      manufacturingDateIso: "2026-09-28",
      factoryCrcBeHex: hex(payload.subarray(0x58, 0x5c)),
      installationCrcBeHex: hex(payload.subarray(0x7c, 0x80)),
    },
    null,
    2,
  ) + "\n",
);

console.log("wrote golden fixtures to", root);
