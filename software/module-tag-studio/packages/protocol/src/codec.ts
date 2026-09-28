import { assertLen, isAllZero, readU16Be, readU32Be, readU64Be, writeU16Be, writeU32Be, writeU64Be, zeros } from "./bytes.js";
import { crc32c, crc32cBytesBe } from "./crc32c.js";
import {
  MAGIC,
  NDEF_ENVELOPE,
  NDEF_TYPE_BYTES,
  PAYLOAD_LENGTH,
  SCHEMA_MAJOR,
  SCHEMA_MINOR,
  TERMINATOR,
  USER_MEMORY_BYTES,
  type DecodeResult,
  type ModuleTagFields,
} from "./types.js";

function copy16(src: Uint8Array, label: string): Uint8Array {
  assertLen(src, 16, label);
  return new Uint8Array(src);
}

export function emptyFields(): ModuleTagFields {
  return {
    schemaMajor: SCHEMA_MAJOR,
    schemaMinor: SCHEMA_MINOR,
    factoryFlags: 0,
    registryId: 0,
    vendorId: 0,
    moduleTypeId: 0,
    definitionRevision: 0,
    hardwareRevision: 0,
    moduleInstanceId: zeros(16),
    deviceBindingHash: zeros(16),
    definitionHash: zeros(16),
    serialNumber: 0n,
    manufacturingLot: 0,
    manufacturingDate: 0,
    fallbackClass: 0,
    fallbackFlags: 0,
    installationId: zeros(16),
    roleId: 0,
    configRevision: 0,
    userFlags: 0,
  };
}

export function encodePayload(fields: ModuleTagFields): Uint8Array {
  const payload = zeros(PAYLOAD_LENGTH);
  const view = new DataView(payload.buffer);

  payload.set(MAGIC, 0);
  payload[4] = fields.schemaMajor;
  payload[5] = fields.schemaMinor;
  payload[6] = fields.factoryFlags & 0x0f; // reserved high bits must be 0
  payload[7] = PAYLOAD_LENGTH;

  writeU16Be(view, 0x08, fields.registryId);
  writeU16Be(view, 0x0a, fields.vendorId);
  writeU32Be(view, 0x0c, fields.moduleTypeId);
  writeU32Be(view, 0x10, fields.definitionRevision);
  writeU32Be(view, 0x14, fields.hardwareRevision);

  payload.set(copy16(fields.moduleInstanceId, "moduleInstanceId"), 0x18);
  payload.set(copy16(fields.deviceBindingHash, "deviceBindingHash"), 0x28);
  payload.set(copy16(fields.definitionHash, "definitionHash"), 0x38);

  writeU64Be(view, 0x48, fields.serialNumber);
  writeU16Be(view, 0x50, fields.manufacturingLot);
  writeU16Be(view, 0x52, fields.manufacturingDate);
  writeU16Be(view, 0x54, fields.fallbackClass);
  writeU16Be(view, 0x56, fields.fallbackFlags);

  const factoryCrc = crc32cBytesBe(payload.subarray(0, 0x58));
  payload.set(factoryCrc, 0x58);

  payload.set(copy16(fields.installationId, "installationId"), 0x5c);
  writeU32Be(view, 0x6c, fields.roleId);
  writeU32Be(view, 0x70, fields.configRevision);
  writeU32Be(view, 0x74, fields.userFlags);
  // 0x78..0x7B reserved = 0

  const installCrc = crc32cBytesBe(payload.subarray(0x5c, 0x7c));
  payload.set(installCrc, 0x7c);

  return payload;
}

/** Full 160-byte user memory (blocks 4..43). */
export function encodeUserMemory(fields: ModuleTagFields): Uint8Array {
  const image = zeros(USER_MEMORY_BYTES);
  image.set(NDEF_ENVELOPE, 0);
  image.set(encodePayload(fields), 28);
  image.set(TERMINATOR, 156);
  return image;
}

export function encodeUserMemoryWithoutMagic(fields: ModuleTagFields): Uint8Array {
  const image = encodeUserMemory(fields);
  image[28] = 0x00;
  image[29] = 0x00;
  image[30] = 0x00;
  image[31] = 0x00;
  return image;
}

export function validateFieldsForWrite(fields: ModuleTagFields): string[] {
  const errors: string[] = [];
  if (fields.schemaMajor !== SCHEMA_MAJOR) errors.push(`schemaMajor must be ${SCHEMA_MAJOR}`);
  if (fields.schemaMinor !== SCHEMA_MINOR) errors.push(`schemaMinor must be ${SCHEMA_MINOR}`);
  if ((fields.factoryFlags & 0xf0) !== 0) errors.push("factoryFlags reserved bits must be zero");
  if (fields.registryId === 0) errors.push("registryId required");
  if (fields.vendorId === 0) errors.push("vendorId required");
  if (fields.moduleTypeId === 0) errors.push("moduleTypeId required");
  if (fields.definitionRevision === 0) errors.push("definitionRevision required");
  if (isAllZero(fields.moduleInstanceId)) errors.push("moduleInstanceId required");
  if (fields.moduleInstanceId.length !== 16) errors.push("moduleInstanceId must be 16 bytes");
  if (fields.deviceBindingHash.length !== 16) errors.push("deviceBindingHash must be 16 bytes");
  if (fields.definitionHash.length !== 16) errors.push("definitionHash must be 16 bytes");
  if (fields.installationId.length !== 16) errors.push("installationId must be 16 bytes");
  return errors;
}

export function decodeUserMemory(userMemory: Uint8Array): DecodeResult {
  if (userMemory.length !== USER_MEMORY_BYTES) {
    return { ok: false, code: "invalid_length", message: `user memory must be ${USER_MEMORY_BYTES} bytes` };
  }
  for (let i = 0; i < NDEF_ENVELOPE.length; i++) {
    if (userMemory[i] !== NDEF_ENVELOPE[i]) {
      return { ok: false, code: "not_slm_ndef", message: "NDEF envelope does not match Spaghetti LAB module record" };
    }
  }
  if (userMemory[156] !== 0xfe) {
    return { ok: false, code: "not_slm_ndef", message: "missing NDEF terminator" };
  }

  const payload = userMemory.slice(28, 156);
  return decodePayload(payload, userMemory);
}

export function decodePayload(payload: Uint8Array, userMemory?: Uint8Array): DecodeResult {
  if (payload.length !== PAYLOAD_LENGTH) {
    return { ok: false, code: "invalid_length", message: `payload must be ${PAYLOAD_LENGTH} bytes` };
  }
  for (let i = 0; i < 4; i++) {
    if (payload[i] !== MAGIC[i]) {
      return { ok: false, code: "bad_magic", message: "magic is not SLM1" };
    }
  }

  const schemaMajor = payload[4]!;
  const schemaMinor = payload[5]!;
  if (schemaMajor !== SCHEMA_MAJOR) {
    return { ok: false, code: "unsupported_schema", message: `unsupported schema major ${schemaMajor}` };
  }

  const factoryFlags = payload[6]!;
  if ((factoryFlags & 0xf0) !== 0) {
    return { ok: false, code: "reserved_nonzero", message: "factoryFlags reserved bits set" };
  }
  if (payload[7] !== PAYLOAD_LENGTH) {
    return { ok: false, code: "invalid_length", message: `payload_length byte is ${payload[7]}, expected ${PAYLOAD_LENGTH}` };
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const expectedFactory = crc32c(payload.subarray(0, 0x58));
  const factoryCrc = readU32Be(view, 0x58);
  if (factoryCrc !== expectedFactory) {
    return { ok: false, code: "bad_factory_crc", message: "factory CRC mismatch" };
  }

  const expectedInstall = crc32c(payload.subarray(0x5c, 0x7c));
  const installationCrc = readU32Be(view, 0x7c);
  const installOk = installationCrc === expectedInstall;

  // reserved 0x78..0x7B
  if (payload[0x78] || payload[0x79] || payload[0x7a] || payload[0x7b]) {
    if (schemaMinor === SCHEMA_MINOR) {
      return { ok: false, code: "reserved_nonzero", message: "mutable reserved block 41 must be zero in V1" };
    }
  }

  const fields: ModuleTagFields = {
    schemaMajor,
    schemaMinor,
    factoryFlags,
    registryId: readU16Be(view, 0x08),
    vendorId: readU16Be(view, 0x0a),
    moduleTypeId: readU32Be(view, 0x0c),
    definitionRevision: readU32Be(view, 0x10),
    hardwareRevision: readU32Be(view, 0x14),
    moduleInstanceId: payload.slice(0x18, 0x28),
    deviceBindingHash: payload.slice(0x28, 0x38),
    definitionHash: payload.slice(0x38, 0x48),
    serialNumber: readU64Be(view, 0x48),
    manufacturingLot: readU16Be(view, 0x50),
    manufacturingDate: readU16Be(view, 0x52),
    fallbackClass: readU16Be(view, 0x54),
    fallbackFlags: readU16Be(view, 0x56),
    installationId: payload.slice(0x5c, 0x6c),
    roleId: readU32Be(view, 0x6c),
    configRevision: readU32Be(view, 0x70),
    userFlags: readU32Be(view, 0x74),
  };

  if (!installOk) {
    return {
      ok: false,
      code: "bad_installation_crc",
      message: "installation CRC mismatch (factory identity still usable)",
      fields,
    };
  }

  return {
    ok: true,
    fields,
    factoryCrc,
    installationCrc,
    payload,
    userMemory: userMemory ?? encodeUserMemory(fields),
  };
}

export function ndefTypeMatches(): boolean {
  return NDEF_TYPE_BYTES.length === 23;
}
