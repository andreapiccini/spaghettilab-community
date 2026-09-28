export type RegistryAuthority = {
  registryId: number;
  name: string;
  baseUrl: string;
  /** Hex-encoded development public key material (not production). */
  trustKeyId: string;
  signature: string;
};

export type ModuleDefinition = {
  identity: {
    vendor_id: number;
    module_type_id: number;
    definition_revision: number;
  };
  hardware: {
    supported_revisions: number[];
    ports: unknown[];
    electrical_limits: Record<string, unknown>;
  };
  functions: unknown[];
  configuration_schema: Record<string, unknown>;
  compatibility: Record<string, unknown>;
  presentation: {
    name: string;
    descriptions: Record<string, string>;
    icons: Record<string, string>;
  };
  signature: { alg: string; value: string };
};

export type DefinitionKey = {
  registryId: number;
  vendorId: number;
  moduleTypeId: number;
  definitionRevision: number;
};

export function definitionCacheKey(key: DefinitionKey): string {
  return `${key.registryId}:${key.vendorId}:${key.moduleTypeId}:${key.definitionRevision}`;
}
