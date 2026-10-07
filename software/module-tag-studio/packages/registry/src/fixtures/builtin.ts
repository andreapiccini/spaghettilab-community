import { canonicalizeJson, hex, truncatedSha256 } from "@spaghettilab/module-tag-protocol";
import type { ModuleDefinition, RegistryAuthority } from "../types.js";
import sharedCatalog from "../../../../../micro-flow-editor/packages/catalog-model/src/nfc-module-catalog.json";

type FunctionalBody = Pick<
  ModuleDefinition,
  "identity" | "hardware" | "functions" | "configuration_schema" | "compatibility"
>;

type CatalogEntry = {
  key: string;
  registryId: number;
  label: string;
  labelIt: string;
  functional: FunctionalBody;
};

const CATALOG: CatalogEntry[] = sharedCatalog.map((entry) => ({
  key: `${entry.registryId}:${entry.vendorId}:${entry.moduleTypeId}:${entry.definitionRevision}`,
  registryId: entry.registryId,
  label: entry.name,
  labelIt: entry.nameIt,
  functional: {
    identity: { vendor_id: entry.vendorId, module_type_id: entry.moduleTypeId, definition_revision: entry.definitionRevision },
    hardware: {
      supported_revisions: entry.supportedHardwareRevisions,
      ports: entry.ports,
      electrical_limits: { max_voltage_v: entry.maxVoltageV },
    },
    functions: entry.functions,
    configuration_schema: { type: "object", properties: {} },
    compatibility: { min_backbone_fw: "0.1.0" },
  },
}));

async function signFunctional(functional: FunctionalBody): Promise<string> {
  const hash = await truncatedSha256(new TextEncoder().encode(canonicalizeJson(functional)));
  return hex(hash);
}

function toDefinition(entry: CatalogEntry, signatureValue: string): ModuleDefinition {
  return {
    ...entry.functional,
    presentation: {
      name: entry.label,
      descriptions: { en: entry.label, it: entry.labelIt },
      icons: {},
    },
    signature: { alg: "dev-hash", value: signatureValue },
  };
}

export const BUILTIN_AUTHORITIES: RegistryAuthority[] = [
  {
    registryId: 1,
    name: "Spaghetti LAB Dev Registry",
    baseUrl: "https://registry.example.invalid",
    trustKeyId: "dev-key-1",
    signature: "dev-authority-sig",
  },
];

/** Human-readable catalog for UI dropdowns (codes + labels). */
export const DEFINITION_CATALOG = CATALOG.map((e) => ({
  key: e.key,
  registryId: e.registryId,
  vendorId: e.functional.identity.vendor_id,
  moduleTypeId: e.functional.identity.module_type_id,
  definitionRevision: e.functional.identity.definition_revision,
  name: e.label,
  nameIt: e.labelIt,
  supportedHardwareRevisions: [...e.functional.hardware.supported_revisions],
}));

export const BUILTIN_DEFINITIONS: Record<string, ModuleDefinition> = Object.fromEntries(
  CATALOG.map((e) => [e.key, toDefinition(e, "pending")]),
);

let ready: Promise<void> | null = null;

export function ensureBuiltinSignatures(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      for (const entry of CATALOG) {
        const sig = await signFunctional(entry.functional);
        BUILTIN_DEFINITIONS[entry.key] = toDefinition(entry, sig);
      }
    })();
  }
  return ready;
}

void ensureBuiltinSignatures();
