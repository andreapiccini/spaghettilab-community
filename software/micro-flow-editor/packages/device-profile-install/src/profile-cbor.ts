import {
  decodeOne,
  encodeArray,
  encodeMap,
  encodeText,
  encodeUint,
  requireArray,
  requireMap,
  requireText,
  requireU32,
  type CborValue,
} from "@spaghettilab/protocol-sdk";
import {
  fromRawOp,
  toRawOp,
  type DeviceProfileDraft,
  type Instruction,
  type RawDeviceProfileOp,
  type SampleField,
} from "@spaghettilab/device-profile-authoring-model";
import { domainError, err, ok, type DomainError, type Result } from "@spaghettilab/domain";
import { DeviceProfileInstallErrorCode } from "./errors.js";

/**
 * Field key order for the top-level CBOR map, and the byte layout of one op
 * and one sample field — every value sourced by reading
 * `firmware/backbone/subsys/device_profiles/device_profile.c`'s
 * `decode_profile_cbor`/`decode_op`/`decode_fields` directly (not the CDDL —
 * there is no `.cddl` file for Device Profiles, only the zcbor decoder in
 * C), not guessed. The decoder reads these keys with `expect_key` in this
 * exact sequential order — this is not a free-order CBOR map, despite the
 * `map` wire type.
 */
const KEY = {
  WIRE: 0,
  ID: 1,
  VERSION: 2,
  TRANSPORT: 3,
  CAPS: 4,
  TIME: 5,
  TX: 6,
  BYTES: 7,
  INIT: 8,
  SAMPLE: 9,
  STOP: 10,
  SCHEMA_ID: 11,
  SCHEMA_VER: 12,
  FIELDS: 13,
} as const;

/** `SPAGHETTI_DEVICE_PROFILE_WIRE_VERSION` (`device_profile.h`) — the only wire revision the firmware decodes today; `decode_profile_cbor` rejects any other value with `-ENOTSUP`. */
export const DEVICE_PROFILE_WIRE_VERSION = 1;

/** `enum spaghetti_value_type` (`schema.h`): `BOOL=0, INT64=1, UINT64=2, TEXT=3, BYTES=4`. Device Profile sample fields only ever use `INT64`/`UINT64` (S061's `SampleFieldType`). */
const VALUE_TYPE = { int64: 1, uint64: 2 } as const;
const VALUE_TYPE_REVERSE: Record<number, "int64" | "uint64"> = { 1: "int64", 2: "uint64" };

function u32(value: number): Uint8Array {
  return encodeUint(BigInt(value));
}

function encodeOp(raw: RawDeviceProfileOp): Uint8Array {
  return encodeArray([u32(raw.opcode), u32(raw.dst), u32(raw.srcA), u32(raw.srcB), u32(raw.imm0), u32(raw.imm1), u32(raw.imm2), u32(raw.imm3)]);
}

function encodeOps(ops: readonly Instruction[]): Uint8Array {
  return encodeArray(ops.map((instruction) => encodeOp(toRawOp(instruction))));
}

function encodeField(field: SampleField): Uint8Array {
  return encodeArray([u32(field.fieldId), u32(VALUE_TYPE[field.type]), encodeText(field.name), encodeText(field.unit ?? "")]);
}

/**
 * Produces the exact `profileCbor` bytes `INSTALL_DEVICE_PROFILE`/
 * `VALIDATE_DEVICE_PROFILE` expect — the piece every earlier package in
 * this chain (S061, S062) explicitly deferred. `draft` must already pass
 * `validateDeviceProfile` (S061); this function does not re-validate, it
 * only encodes.
 */
export function encodeDeviceProfileCbor(draft: DeviceProfileDraft): Uint8Array {
  return encodeMap([
    [KEY.WIRE, u32(DEVICE_PROFILE_WIRE_VERSION)],
    [KEY.ID, encodeText(draft.profileId)],
    [KEY.VERSION, u32(draft.version)],
    [KEY.TRANSPORT, u32(draft.transport)],
    [KEY.CAPS, u32(draft.requiredCapabilities)],
    [KEY.TIME, u32(draft.maxTotalTimeMs)],
    [KEY.TX, u32(draft.maxTransactions)],
    [KEY.BYTES, u32(draft.maxBytes)],
    [KEY.INIT, encodeOps(draft.initOps)],
    [KEY.SAMPLE, encodeOps(draft.sampleOps)],
    [KEY.STOP, encodeOps(draft.safeStopOps)],
    [KEY.SCHEMA_ID, encodeText(draft.sampleSchemaId)],
    [KEY.SCHEMA_VER, u32(draft.sampleSchemaVersion)],
    [KEY.FIELDS, encodeArray(draft.sampleFields.map(encodeField))],
  ]);
}

function malformed(target: string, remediation: string): DomainError {
  return domainError({ code: DeviceProfileInstallErrorCode.MALFORMED_CBOR, path: ["device-profile-install", "cbor"], target, remediation });
}

function decodeOpValue(value: CborValue): Result<RawDeviceProfileOp, DomainError> {
  if (value.kind !== "array" || value.value.length !== 8) {
    return err(malformed("op", "expected an 8-element array [opcode,dst,srcA,srcB,imm0,imm1,imm2,imm3]"));
  }
  const numbers = value.value.map((v) => (v.kind === "uint" ? Number(v.value) : undefined));
  if (numbers.some((n) => n === undefined)) {
    return err(malformed("op", "every op field must be a uint"));
  }
  const [opcode, dst, srcA, srcB, imm0, imm1, imm2, imm3] = numbers as number[];
  return ok({ opcode: opcode!, dst: dst!, srcA: srcA!, srcB: srcB!, imm0: imm0!, imm1: imm1!, imm2: imm2!, imm3: imm3! });
}

function decodeOpsValue(items: readonly CborValue[]): Result<Instruction[], DomainError> {
  const instructions: Instruction[] = [];
  for (const opValue of items) {
    const raw = decodeOpValue(opValue);
    if (!raw.ok) return raw;
    const instruction = fromRawOp(raw.value);
    if (!instruction.ok) return err(instruction.error);
    instructions.push(instruction.value);
  }
  return ok(instructions);
}

function decodeFieldValue(value: CborValue): Result<SampleField, DomainError> {
  if (value.kind !== "array" || value.value.length !== 4) {
    return err(malformed("sampleField", "expected a 4-element array [fieldId,type,name,unit]"));
  }
  const [fieldIdValue, typeValue, nameValue, unitValue] = value.value as readonly [CborValue, CborValue, CborValue, CborValue];
  if (fieldIdValue.kind !== "uint" || typeValue.kind !== "uint" || nameValue.kind !== "text" || unitValue.kind !== "text") {
    return err(malformed("sampleField", "expected [uint, uint, text, text]"));
  }
  const type = VALUE_TYPE_REVERSE[Number(typeValue.value)];
  if (type === undefined) {
    return err(malformed("sampleField.type", `unsupported value type ${typeValue.value} — Device Profile sample fields are INT64/UINT64 only`));
  }
  const unit = unitValue.value;
  return ok({ fieldId: Number(fieldIdValue.value), type, name: nameValue.value, unit: unit.length > 0 ? unit : undefined });
}

/**
 * Parses `profileCbor` bytes back into a `DeviceProfileDraft` — the inverse
 * of `encodeDeviceProfileCbor`, used to verify a round trip and (via
 * `install-workflow.ts`) to inspect what a `GET_DEVICE_PROFILE`-adjacent
 * source actually contains. Never executes anything: this is CBOR parsing
 * and structural mapping only, the same "no eval, no dynamic import"
 * guarantee `@spaghettilab/device-profile-package`'s import path has.
 */
export function decodeDeviceProfileCbor(bytes: Uint8Array): Result<DeviceProfileDraft, DomainError> {
  let root: CborValue;
  try {
    root = decodeOne(bytes);
  } catch (cause) {
    return err(domainError({ code: DeviceProfileInstallErrorCode.MALFORMED_CBOR, path: ["device-profile-install", "cbor"], target: "bytes", remediation: "not valid CBOR", cause }));
  }
  let map: ReturnType<typeof requireMap>;
  try {
    map = requireMap(root, "DeviceProfileCbor");
  } catch {
    return err(malformed("root", "expected a CBOR map"));
  }

  try {
    const wireVersion = requireU32(map, KEY.WIRE, "DeviceProfileCbor");
    if (wireVersion !== DEVICE_PROFILE_WIRE_VERSION) {
      return err(
        domainError({
          code: DeviceProfileInstallErrorCode.UNSUPPORTED_WIRE_VERSION,
          path: ["device-profile-install", "cbor", "wireVersion"],
          target: String(wireVersion),
          remediation: `this decoder only understands wire version ${DEVICE_PROFILE_WIRE_VERSION}`,
        }),
      );
    }

    const initOps = decodeOpsValue(requireArray(map, KEY.INIT, "DeviceProfileCbor"));
    if (!initOps.ok) return initOps;
    const sampleOps = decodeOpsValue(requireArray(map, KEY.SAMPLE, "DeviceProfileCbor"));
    if (!sampleOps.ok) return sampleOps;
    const safeStopOps = decodeOpsValue(requireArray(map, KEY.STOP, "DeviceProfileCbor"));
    if (!safeStopOps.ok) return safeStopOps;

    const fieldsValue = requireArray(map, KEY.FIELDS, "DeviceProfileCbor");
    const sampleFields: SampleField[] = [];
    for (const fv of fieldsValue) {
      const field = decodeFieldValue(fv);
      if (!field.ok) return field;
      sampleFields.push(field.value);
    }

    const draft: DeviceProfileDraft = {
      profileId: requireText(map, KEY.ID, "DeviceProfileCbor"),
      version: requireU32(map, KEY.VERSION, "DeviceProfileCbor"),
      transport: requireU32(map, KEY.TRANSPORT, "DeviceProfileCbor"),
      requiredCapabilities: requireU32(map, KEY.CAPS, "DeviceProfileCbor"),
      maxTotalTimeMs: requireU32(map, KEY.TIME, "DeviceProfileCbor"),
      maxTransactions: requireU32(map, KEY.TX, "DeviceProfileCbor"),
      maxBytes: requireU32(map, KEY.BYTES, "DeviceProfileCbor"),
      initOps: initOps.value,
      sampleOps: sampleOps.value,
      safeStopOps: safeStopOps.value,
      sampleSchemaId: requireText(map, KEY.SCHEMA_ID, "DeviceProfileCbor"),
      sampleSchemaVersion: requireU32(map, KEY.SCHEMA_VER, "DeviceProfileCbor"),
      sampleFields,
    };
    return ok(draft);
  } catch (cause) {
    return err(domainError({ code: DeviceProfileInstallErrorCode.MALFORMED_CBOR, path: ["device-profile-install", "cbor"], target: "root", remediation: "a required field is missing or has the wrong CBOR type", cause }));
  }
}
