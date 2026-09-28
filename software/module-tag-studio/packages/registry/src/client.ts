import { canonicalizeJson, definitionHashFromJson, hex } from "@spaghettilab/module-tag-protocol";
import { definitionCacheKey, type DefinitionKey, type ModuleDefinition, type RegistryAuthority } from "./types.js";
import { BUILTIN_AUTHORITIES, BUILTIN_DEFINITIONS, ensureBuiltinSignatures } from "./fixtures/builtin.js";

export type ResolveResult =
  | { ok: true; definition: ModuleDefinition; definitionHash: Uint8Array; source: "cache" | "builtin" | "network" }
  | { ok: false; reason: "unknown_registry" | "not_found" | "hash_mismatch" | "bad_signature" | "offline"; message: string };

export class RegistryClient {
  private cache = new Map<string, ModuleDefinition>();
  private authorities: RegistryAuthority[];

  constructor(authorities: RegistryAuthority[] = BUILTIN_AUTHORITIES) {
    this.authorities = authorities;
  }

  listAuthorities(): readonly RegistryAuthority[] {
    return this.authorities;
  }

  listCachedKeys(): string[] {
    return [...this.cache.keys()];
  }

  putCache(key: DefinitionKey, definition: ModuleDefinition): void {
    this.cache.set(definitionCacheKey(key), definition);
  }

  async resolve(key: DefinitionKey, options?: { allowNetwork?: boolean }): Promise<ResolveResult> {
    await ensureBuiltinSignatures();
    for (const [k, def] of Object.entries(BUILTIN_DEFINITIONS)) {
      if (!this.cache.has(k)) this.cache.set(k, def);
    }

    const authority = this.authorities.find((a) => a.registryId === key.registryId);
    if (!authority) {
      return { ok: false, reason: "unknown_registry", message: `registry_id ${key.registryId} is not in the signed authority list` };
    }

    const cacheKey = definitionCacheKey(key);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return this.verify(cached, BUILTIN_DEFINITIONS[cacheKey] ? "builtin" : "cache");
    }

    if (options?.allowNetwork && authority.baseUrl.startsWith("http")) {
      try {
        const url = `${authority.baseUrl.replace(/\/$/, "")}/v1/vendors/${key.vendorId}/modules/${key.moduleTypeId}/definitions/${key.definitionRevision}`;
        const response = await fetch(url);
        if (response.ok) {
          const definition = (await response.json()) as ModuleDefinition;
          this.cache.set(cacheKey, definition);
          return this.verify(definition, "network");
        }
      } catch {
        /* fall through */
      }
    }

    return {
      ok: false,
      reason: "offline",
      message: "Definition not in local cache and registry is unreachable. Showing fallback class only.",
    };
  }

  private async verify(definition: ModuleDefinition, source: "cache" | "builtin" | "network"): Promise<ResolveResult> {
    if (!definition.signature?.value || definition.signature.value === "pending") {
      return { ok: false, reason: "bad_signature", message: "definition missing signature" };
    }
    const functional = {
      identity: definition.identity,
      hardware: definition.hardware,
      functions: definition.functions,
      configuration_schema: definition.configuration_schema,
      compatibility: definition.compatibility,
    };
    const hash = await definitionHashFromJson(functional);
    const expectedSig = hex(hash);
    if (definition.signature.value !== expectedSig) {
      return { ok: false, reason: "bad_signature", message: "registry signature/hash mismatch" };
    }
    return { ok: true, definition, definitionHash: hash, source };
  }

  canonicalizeFunctional(definition: ModuleDefinition): string {
    return canonicalizeJson({
      identity: definition.identity,
      hardware: definition.hardware,
      functions: definition.functions,
      configuration_schema: definition.configuration_schema,
      compatibility: definition.compatibility,
    });
  }
}
