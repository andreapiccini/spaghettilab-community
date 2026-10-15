import { decodeConfigCbor } from "@spaghettilab/config-decompiler";
import type { DeviceProfileDraft } from "@spaghettilab/device-profile-authoring-model";
import type { SpaghettiClient, ModuleCommandValue } from "@spaghettilab/protocol-sdk";
import { compileRuntimeDriver } from "./driver-runtime-profile.js";
import {
  createNamedAction,
  type DeviceRecipeDraft,
  type DeviceRecipeOp,
} from "./device-recipe-draft.js";
import { type CompiledDisplayCall, displayAdapterOutputs } from "./display-tool.js";
import { type AdapterValue } from "./display-adapter-expression.js";
import { buildRecipeTestConfigBytes } from "./recipe-to-test-profile.js";
import {
  parkLiveConfig,
  restoreParkedConfig,
  ensureRecipeTestI2cPhysical,
  withExclusiveRecipeHardwareTest,
  type ParkedLiveConfig,
} from "./recipe-hardware-test.js";
import type { BackbonePhysicalDraft } from "./backbone-physical.js";

/** Reuse parameterized actions while streaming a scene: one APPLY/restore, never one per pixel. */
export function compileDisplayRuntime(
  driver: DeviceRecipeDraft,
  calls: readonly CompiledDisplayCall[],
  withInit: boolean,
) {
  if (driver.binding.bus !== "i2c" || (driver.binding.i2c?.addressBits ?? 7) !== 7)
    throw new Error("La prova hardware del tool richiede un driver I²C a 7 bit.");
  const address = Number.parseInt(
    driver.binding.i2c?.address.replace(/^0x/i, "") ?? "",
    16,
  );
  if (!Number.isInteger(address) || address < 8 || address > 0x77)
    throw new Error("Indirizzo I²C non valido.");
  const groups = new Map<
    string,
    { id: string; steps: readonly DeviceRecipeOp[]; inputs: readonly string[] }
  >();
  const requests: { actionId: string; values: readonly Uint8Array[] }[] = [];
  for (const call of calls) {
    const values: Uint8Array[] = [],
      inputs: DeviceRecipeOp[] = [];
    const payload = (bytes: readonly string[]) => {
      const refs: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 8) {
        const chunk = bytes.slice(offset, offset + 8);
        if (chunk.some((byte) => !/^(?:0x)?[a-f0-9]{1,2}$/i.test(byte)))
          throw new Error("L’adapter deve risolvere tutti i byte prima della prova.");
        const name = `tool_arg_${values.length}`;
        values.push(
          Uint8Array.from(
            chunk.map((byte) => Number.parseInt(byte.replace(/^0x/i, ""), 16)),
          ),
        );
        inputs.push({
          id: name,
          type: "sample_external",
          fromChannelId: name,
          into: name,
          valueType: "hex",
          widthBytes: chunk.length,
          byteOrder: "be",
        });
        refs.push(`$${name}`);
      }
      return refs;
    };
    const steps = call.steps.map((op): DeviceRecipeOp => {
      if (op.type === "i2c_write") return { ...op, bytes: payload(op.bytes) };
      if (op.type === "i2c_write_read")
        return { ...op, writeBytes: payload(op.writeBytes) };
      if (op.type === "i2c_read" || op.type === "wait") return op;
      throw new Error(
        `La prova hardware non supporta ${op.type}. Usa letture, scritture o attese I²C nel driver.`,
      );
    });
    if (values.length > 8)
      throw new Error(
        `${call.actionLabel}: oltre 8 parametri per chiamata. Dividi l’azione del driver.`,
      );
    // Slot widths and bus structure define the template; coordinates/bytes remain arguments.
    const signature = JSON.stringify({
      inputs: inputs.map((op) => (op.type === "sample_external" ? op.widthBytes : 0)),
      steps: steps.map((op) => ({
        ...op,
        id: "",
        ...("into" in op ? { into: "rx" } : {}),
      })),
    });
    let group = groups.get(signature);
    if (!group) {
      group = {
        id: `tool-action-${groups.size}`,
        steps: [...inputs, ...steps],
        inputs: inputs.map((op) => op.id),
      };
      groups.set(signature, group);
    }
    requests.push({ actionId: group.id, values });
  }
  const commands = [...groups.values()].map((group) =>
    createNamedAction({ id: group.id, label: group.id, steps: group.steps }),
  );
  const compiled = compileRuntimeDriver(
    {
      ...driver,
      category: "sensor",
      commands,
      flowInterfaces: [],
      flowInterfaceActions: {},
      variables: [],
      channels: [],
      phases: { init: withInit ? driver.phases.init : [], sample: [], command: [] },
    },
    new Map([...groups.values()].map((group) => [group.id, new Set(group.inputs)])),
  );
  const profile: DeviceProfileDraft = {
    ...compiled.profile,
    profileId: `try.display.${compiled.profile.profileId.replace(/^drv\./, "")}`,
  };
  return {
    profile,
    address,
    requests: requests.map((request) => {
      const action = compiled.actions.get(request.actionId)!;
      const args: Record<number, ModuleCommandValue> = {};
      request.values.forEach((bytes, index) => {
        args[action.inputIds[`tool_arg_${index}`]!] = bytes;
      });
      return { commandId: action.commandId, arguments: args };
    }),
  };
}
async function restoreDisplayConfiguration(
  client: SpaghettiClient,
  parked: ParkedLiveConfig,
) {
  try {
    await restoreParkedConfig(client, parked);
  } catch (error) {
    throw new Error(
      `Ripristino della configurazione precedente non riuscito: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
export type DisplayHardwareResult = {
  index: number;
  values: Readonly<Record<string, AdapterValue>>;
  reads: readonly (readonly number[])[];
};
export async function runDisplayProgram(input: {
  client: SpaghettiClient;
  driver: DeviceRecipeDraft;
  calls: readonly CompiledDisplayCall[];
  withInit: boolean;
  installProfile: (profile: DeviceProfileDraft) => Promise<void>;
  removeProfile: (id: string, version: number) => Promise<void>;
  physical?: BackbonePhysicalDraft;
  signal?: AbortSignal;
  onProgress?: (
    completed: number,
    total: number,
    result: DisplayHardwareResult,
  ) => void;
}): Promise<void> {
  const program = compileDisplayRuntime(input.driver, input.calls, input.withInit);
  await withExclusiveRecipeHardwareTest(input.client, async () => {
    input.signal?.throwIfAborted();
    const parked = await parkLiveConfig(input.client);
    const existing = await input.client.getFullDeviceProfileList();
    const alreadyInstalled = existing.some(
      (profile) =>
        profile.profileId === program.profile.profileId &&
        profile.version === program.profile.version,
    );
    let installed = false,
      attemptedApply = false;
    try {
      input.signal?.throwIfAborted();
      if (!alreadyInstalled) {
        await input.installProfile(program.profile);
        installed = true;
      }
      const bytes = buildRecipeTestConfigBytes({
        profileId: program.profile.profileId,
        profileVersion: program.profile.version,
        i2cAddress: program.address,
        periodMs: null,
        parkedConfigBytes: parked.configBytes,
      });
      if (!bytes) throw new Error("Configurazione temporanea non compilabile.");
      const decoded = decodeConfigCbor(bytes);
      if (!decoded.ok || !decoded.value.modules[0])
        throw new Error("Modulo temporaneo non disponibile.");
      const validation = await input.client.validateConfig(
        { configBytes: bytes },
        input.signal,
      );
      if (!validation.valid)
        throw new Error("Il Core ha rifiutato la configurazione temporanea del tool.");
      const fresh = await input.client.getConfig(input.signal);
      attemptedApply = true;
      const physical = await ensureRecipeTestI2cPhysical(input.client, {
        parkedConfigBytes: parked.configBytes,
        expectedGeneration: fresh.generation,
        preferredModes: input.physical?.modes,
        preferredI2cSpeed: input.physical?.i2cSpeed,
        preferredSettings: input.physical?.settings,
        signal: input.signal,
      });
      await input.client.applyConfig(
        { expectedGeneration: physical.generation, configBytes: bytes },
        input.signal,
      );
      for (let index = 0; index < program.requests.length; index++) {
        input.signal?.throwIfAborted();
        const response = await input.client.moduleCommand(
          { key: decoded.value.modules[0].key, ...program.requests[index]! },
          input.signal,
        );
        const reads = (response.rxReads ?? []).map((bytes) => [...bytes]);
        if (response.rxTruncated)
          throw new Error(
            "Risposta RX incompleta: riduci le letture nell’azione del driver.",
          );
        const values = displayAdapterOutputs(input.calls[index]!, reads);
        input.onProgress?.(index + 1, program.requests.length, {
          index,
          values,
          reads,
        });
      }
    } finally {
      // Restore even after cancellation or a failed command; the signal must not cancel cleanup.
      if (attemptedApply) {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await restoreDisplayConfiguration(input.client, parked);
      }
      if (installed)
        await input.removeProfile(program.profile.profileId, program.profile.version);
    }
  });
}
