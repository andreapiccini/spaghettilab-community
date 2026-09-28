export const MAGIC = new Uint8Array([0x53, 0x4c, 0x4d, 0x31]); // SLM1
export const NDEF_TYPE = "spaghettilab.com:module";
export const NDEF_TYPE_BYTES = new TextEncoder().encode(NDEF_TYPE);
export const SCHEMA_MAJOR = 1;
export const SCHEMA_MINOR = 0;
export const PAYLOAD_LENGTH = 128;
export const USER_MEMORY_BYTES = 160;
export const USER_FIRST_PAGE = 4;
export const USER_LAST_PAGE = 43;
export const TOTAL_PAGES = 64;
export const PAGE_SIZE = 4;
export const PRODUCT_CODE_ST25TN01K = 0x9090;
export const PRODUCT_PAGE = 45;
export const DYNLOCK_PAGE = 44;
export const TERMINATOR = new Uint8Array([0xfe, 0x00, 0x00, 0x00]);

/** Fixed NDEF envelope for blocks 4..10 (28 bytes). */
export const NDEF_ENVELOPE = Uint8Array.of(
  0x03,
  0x9a,
  0xd4,
  0x17,
  0x80,
  0x73,
  0x70,
  0x61, // spa
  0x67,
  0x68,
  0x65,
  0x74, // ghet
  0x74,
  0x69,
  0x6c,
  0x61, // tila
  0x62,
  0x2e,
  0x63,
  0x6f, // b.co
  0x6d,
  0x3a,
  0x6d,
  0x6f, // m:mo
  0x64,
  0x75,
  0x6c,
  0x65, // dule
);

export const FactoryFlags = {
  HAS_DEVICE_BINDING: 1 << 0,
  HAS_DEFINITION_HASH: 1 << 1,
  HAS_FALLBACK_SUMMARY: 1 << 2,
  PRODUCTION_UNIT: 1 << 3,
} as const;

export const FallbackClass = {
  Unknown: 0x0000,
  Backbone: 0x0001,
  Power: 0x0002,
  Sensor: 0x0003,
  Actuator: 0x0004,
  Interface: 0x0005,
  Controller: 0x0006,
  Adapter: 0x0007,
} as const;

export type ModuleTagFields = {
  schemaMajor: number;
  schemaMinor: number;
  factoryFlags: number;
  registryId: number;
  vendorId: number;
  moduleTypeId: number;
  definitionRevision: number;
  hardwareRevision: number;
  moduleInstanceId: Uint8Array; // 16
  deviceBindingHash: Uint8Array; // 16
  definitionHash: Uint8Array; // 16
  serialNumber: bigint;
  manufacturingLot: number;
  manufacturingDate: number;
  fallbackClass: number;
  fallbackFlags: number;
  installationId: Uint8Array; // 16
  roleId: number;
  configRevision: number;
  userFlags: number;
};

export type DecodeOk = {
  ok: true;
  fields: ModuleTagFields;
  factoryCrc: number;
  installationCrc: number;
  userMemory: Uint8Array;
  payload: Uint8Array;
};

export type DecodeErr = {
  ok: false;
  code:
    | "unsupported_tag"
    | "not_slm_ndef"
    | "bad_magic"
    | "unsupported_schema"
    | "bad_factory_crc"
    | "bad_installation_crc"
    | "reserved_nonzero"
    | "truncated"
    | "invalid_length";
  message: string;
  fields?: Partial<ModuleTagFields>;
};

export type DecodeResult = DecodeOk | DecodeErr;

export type PlanStep = {
  page: number;
  before: Uint8Array | null;
  after: Uint8Array;
  reason: string;
  rollbackPossible: boolean;
  irreversible: boolean;
};

export type WritePlan = {
  steps: PlanStep[];
  expectedUserMemory: Uint8Array;
  expectedPages: Map<number, Uint8Array>;
  backupRequired: boolean;
  description: string;
};
