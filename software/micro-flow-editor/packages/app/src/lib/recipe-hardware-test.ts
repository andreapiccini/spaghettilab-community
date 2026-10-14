import {
  evaluateRecipeReadResults,
  type RecipeReadResult,
} from "./recipe-read-results.js";
import { encodeConfigCbor } from "@spaghettilab/config-compiler";
import { decodeConfigCbor } from "@spaghettilab/config-decompiler";
import {
  DEFAULT_PHYSICAL_SETTINGS,
  type PhysicalInterfaceSettings,
  type SpaghettiClient,
} from "@spaghettilab/protocol-sdk";
import {
  addPortInterface,
  expectedFunctionTag,
  modesForVariant,
  modesProvideBus,
  tagForSlot,
  topologyForBoard,
} from "./backbone-physical.js";
import {
  describeDeviceOp,
  type DeviceRecipeDraft,
  type DeviceRecipeOp,
  type DeviceRecipePhase,
} from "./device-recipe-draft.js";
import { buildRecipeBusCapture, type RecipeBusCapture } from "./recipe-bus-capture.js";
import { formatValidateConfigFailure } from "./recipe-test-config-errors.js";
import {
  buildRecipeTestConfigBytes,
  recipePlanToTestProfile,
} from "./recipe-to-test-profile.js";

/** APPLY_PHYSICAL wire: exactly 4 bytes; SDK rejects mode base > 12 (ADC/W1). */
function toApplyPhysicalModes(modes: readonly number[]): number[] {
  return modesForVariant(modes, "v1")
    .slice(0, 4)
    .map((mode) => ((mode & 15) > 12 ? 0 : mode));
}

/** Wire modes for APPLY_PHYSICAL (firmware accepts exactly 4 pin bytes). */
export function modesForRecipeTestI2c(
  liveModes: readonly number[] | undefined,
  preferredModes?: readonly number[],
): number[] {
  if (modesProvideBus(preferredModes, "i2c")) {
    return toApplyPhysicalModes(preferredModes!);
  }
  if (modesProvideBus(liveModes, "i2c")) {
    return toApplyPhysicalModes(liveModes!);
  }
  const base = liveModes?.length ? toApplyPhysicalModes(liveModes) : [0, 0, 0, 0];
  try {
    return toApplyPhysicalModes(addPortInterface(base, "i2c"));
  } catch {
    return [4, 5, 0, 0];
  }
}

/** Firmware default `CONFIG_SPAGHETTI_CONFIG_MIN_WRITE_INTERVAL_MS` is 1000. */
const CONFIG_WRITE_GAP_MS = 1100;

async function releaseModulesForPhysical(
  client: SpaghettiClient,
  parkedConfigBytes: Uint8Array,
  expectedGeneration: number,
  signal?: AbortSignal,
): Promise<{ readonly generation: number; readonly wrote: boolean }> {
  const decoded = decodeConfigCbor(parkedConfigBytes);
  if (!decoded.ok || decoded.value.modules.length === 0) {
    return { generation: expectedGeneration, wrote: false };
  }
  const cleared = encodeConfigCbor({
    ...decoded.value,
    modules: [],
    schedules: [],
    rules: [],
    blocks: [],
    edges: [],
  });
  await client.applyConfig({ expectedGeneration, configBytes: cleared }, signal);
  const fresh = await client.getConfig(signal);
  return { generation: fresh.generation, wrote: true };
}

/**
 * VALIDATE_CONFIG does not touch Port pinmux. On Core, once a physical map was
 * saved (`user_config[0]==1`), I²C acquire re-applies that map — without SDA/SCL
 * (modes 4/5) APPLY_CONFIG init/acquire often returns INTERNAL_ERROR.
 * Ensure Port 0 has I²C before the test APPLY.
 */
export async function ensureRecipeTestI2cPhysical(
  client: SpaghettiClient,
  opts: {
    readonly parkedConfigBytes: Uint8Array;
    readonly expectedGeneration: number;
    readonly preferredModes?: readonly number[];
    readonly preferredI2cSpeed?: number;
    readonly preferredSettings?: PhysicalInterfaceSettings;
    readonly signal?: AbortSignal;
  },
): Promise<{
  readonly applied: boolean;
  readonly generation: number;
  readonly modes?: readonly number[];
}> {
  const status = await client.getStatus(opts.signal);
  const peer = status.chainPeers?.find((p) => p.local);
  const board = { local: true as const, nodeId: peer?.nodeId ?? 0 };
  const topology = topologyForBoard(status, board);
  if (modesProvideBus(topology?.modes, "i2c")) {
    return {
      applied: false,
      generation: opts.expectedGeneration,
      modes: topology?.modes,
    };
  }

  let generation = opts.expectedGeneration;
  let wroteConfig = false;
  try {
    const released = await releaseModulesForPhysical(
      client,
      opts.parkedConfigBytes,
      generation,
      opts.signal,
    );
    generation = released.generation;
    wroteConfig = released.wrote;
  } catch {
    // Best-effort: Port may already be free.
  }

  const modes = modesForRecipeTestI2c(topology?.modes, opts.preferredModes);
  const tag = tagForSlot(status, board, 2);
  const automatic = Boolean(tag?.registryId && tag?.vendorId && tag?.moduleTypeId);
  await client.applyPhysical(
    {
      nodeId: 0,
      modes: new Uint8Array(modes),
      i2cSpeed: opts.preferredI2cSpeed ?? topology?.i2cSpeed ?? 0,
      expectedTag: expectedFunctionTag(tag, automatic),
      settings:
        topology?.version === 2
          ? (opts.preferredSettings ?? topology.settings ?? DEFAULT_PHYSICAL_SETTINGS)
          : undefined,
    },
    opts.signal,
  );
  // Two APPLY_CONFIG within <1s → -EBUSY on stock firmware; wait out the gap.
  if (wroteConfig) {
    await sleep(CONFIG_WRITE_GAP_MS, opts.signal);
  }
  const fresh = await client.getConfig(opts.signal);
  return { applied: true, generation: fresh.generation, modes };
}

/** What to execute once on the Backbone — never writes the Flow canvas. */
export type RecipeTestTarget =
  | { readonly kind: "init" }
  | { readonly kind: "task" }
  | { readonly kind: "action"; readonly commandId?: string };

export type RecipeTestSelection = {
  readonly target: RecipeTestTarget;
  /** Run `phases.init` once before the chosen Task / Action. */
  readonly runInitFirst: boolean;
};

export type RecipeTestPlanStep = {
  readonly phase: DeviceRecipePhase | "command_named";
  readonly phaseLabel: string;
  readonly op: DeviceRecipeOp;
  readonly description: string;
};

export type RecipeTestPlan = {
  readonly selection: RecipeTestSelection;
  readonly steps: readonly RecipeTestPlanStep[];
};

export type ParkedLiveConfig = {
  readonly generation: number;
  readonly configBytes: Uint8Array;
  readonly sha256: Uint8Array;
};

export type RecipeHardwareTestResult = {
  readonly ok: boolean;
  readonly kind:
    | "applied"
    | "module_command"
    | "no_client"
    | "empty_plan"
    | "profile_failed"
    | "apply_failed"
    | "command_failed"
    | "restore_failed";
  readonly plan: RecipeTestPlan;
  readonly capture: RecipeBusCapture;
  readonly parked: ParkedLiveConfig | null;
  readonly restored: boolean;
  readonly note: string;
  readonly error?: string;
  readonly skippedOps?: readonly string[];
  readonly rxTruncated?: boolean;
  readonly readResults?: readonly RecipeReadResult[];
};

function phaseOps(
  draft: DeviceRecipeDraft,
  phase: DeviceRecipePhase,
): readonly DeviceRecipeOp[] {
  return draft.phases[phase] ?? [];
}

function actionOps(
  draft: DeviceRecipeDraft,
  commandId?: string,
): readonly DeviceRecipeOp[] {
  if (draft.commands.length > 0) {
    const cmd =
      (commandId ? draft.commands.find((c) => c.id === commandId) : undefined) ??
      draft.commands[0];
    return cmd?.steps ?? [];
  }
  // Legacy fallback before migrate
  return phaseOps(draft, "command").length
    ? phaseOps(draft, "command")
    : phaseOps(draft, "sample");
}

/**
 * Flatten Init (optional) + one named Action into an ordered plan.
 * Legacy `task` target maps to the first named action (or legacy sample).
 * Does not touch project / canvas state.
 */
export function buildRecipeTestPlan(
  draft: DeviceRecipeDraft,
  selection: RecipeTestSelection,
  labels: { readonly init: string; readonly task: string; readonly action: string },
): RecipeTestPlan {
  const steps: RecipeTestPlanStep[] = [];

  if (selection.runInitFirst || selection.target.kind === "init") {
    for (const op of phaseOps(draft, "init")) {
      steps.push({
        phase: "init",
        phaseLabel: labels.init,
        op,
        description: describeDeviceOp(op),
      });
    }
  }

  if (selection.target.kind === "init") return { selection, steps };

  const cmdId =
    selection.target.kind === "action"
      ? selection.target.commandId
      : draft.commands[0]?.id;
  const cmd = cmdId ? draft.commands.find((c) => c.id === cmdId) : draft.commands[0];
  const actionLabel = cmd
    ? `${labels.action}: ${cmd.label || cmd.name}`
    : selection.target.kind === "task"
      ? labels.task
      : labels.action;
  for (const op of actionOps(draft, cmd?.id ?? cmdId)) {
    steps.push({
      phase: "command_named",
      phaseLabel: actionLabel,
      op,
      description: describeDeviceOp(op),
    });
  }

  return { selection, steps };
}

/** Snapshot live Backbone config — canvas / project are never modified. */
export async function parkLiveConfig(
  client: SpaghettiClient,
): Promise<ParkedLiveConfig> {
  const live = await client.getConfig();
  return {
    generation: live.generation,
    configBytes: live.configBytes.slice(),
    sha256: live.sha256.slice(),
  };
}

/** Re-apply a previously parked config (compare-and-swap on current generation). */
export async function restoreParkedConfig(
  client: SpaghettiClient,
  parked: ParkedLiveConfig,
): Promise<void> {
  const current = await client.getConfig();
  await client.applyConfig({
    expectedGeneration: current.generation,
    configBytes: parked.configBytes,
  });
}

export type RunRecipeHardwareTestInput = {
  readonly client: SpaghettiClient | undefined;
  readonly draft: DeviceRecipeDraft;
  readonly selection: RecipeTestSelection;
  readonly labels: {
    readonly init: string;
    readonly task: string;
    readonly action: string;
  };
  /** Optional MODULE_COMMAND when Action maps to an already-deployed module. */
  readonly moduleCommand?: { readonly key: number; readonly commandId: number };
  readonly installProfile?: (
    draft: import("@spaghettilab/device-profile-authoring-model").DeviceProfileDraft,
  ) => Promise<{
    ok: boolean;
    error?: string;
  }>;
  /** Optional: remove prior Testa profiles (`try.*`) so catalog slots stay free. */
  readonly cleanupTryProfiles?: () => Promise<void>;
  readonly i2cAddress?: number;
  readonly portId?: number;
  /** Preferred Module Function modes (from Cablaggio draft) when live Port lacks I²C. */
  readonly preferredPhysicalModes?: readonly number[];
  readonly preferredI2cSpeed?: number;
  readonly preferredPhysicalSettings?: PhysicalInterfaceSettings;
  readonly signal?: AbortSignal;
  /** How long to leave the test config active so a sample can fire (ms). */
  readonly sampleWaitMs?: number;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Canvas-safe Backbone test:
 * 1. Build plan + RX/TX capture for the timing diagram (always).
 * 2. Park live GET_CONFIG.
 * 3. Install temp profile → APPLY mini-config → wait → restore.
 * Never mutates the Flow canvas / project graphs.
 */
const activeHardwareTests = new WeakSet<SpaghettiClient>();

/** One temporary config transaction at a time per connected Core, including restore. */
export async function runRecipeHardwareTest(
  input: RunRecipeHardwareTestInput,
): Promise<RecipeHardwareTestResult> {
  if (!input.client) return runRecipeHardwareTestUnlocked(input);
  if (activeHardwareTests.has(input.client)) {
    const plan = buildRecipeTestPlan(input.draft, input.selection, input.labels);
    return {
      ok: false,
      kind: "apply_failed",
      plan,
      capture: buildRecipeBusCapture(plan.steps.map((s) => s.op)),
      parked: null,
      restored: false,
      note: "Una prova è già in corso su questa Backbone. Attendi il suo completamento.",
    };
  }
  activeHardwareTests.add(input.client);
  try {
    return await runRecipeHardwareTestUnlocked(input);
  } finally {
    activeHardwareTests.delete(input.client);
  }
}

async function runRecipeHardwareTestUnlocked(
  input: RunRecipeHardwareTestInput,
): Promise<RecipeHardwareTestResult> {
  const plan = buildRecipeTestPlan(input.draft, input.selection, input.labels);
  const ops = plan.steps.map((s) => s.op);
  const capture = buildRecipeBusCapture(ops);

  if (plan.steps.length === 0) {
    return {
      ok: false,
      kind: "empty_plan",
      plan,
      capture,
      parked: null,
      restored: false,
      note: "La selezione non ha passi da eseguire.",
    };
  }

  if (!input.client) {
    return {
      ok: false,
      kind: "no_client",
      plan,
      capture,
      parked: null,
      restored: false,
      note: "Diagramma pronto. Collega un Core READY per eseguire sul bus reale.",
    };
  }

  // Path B — Action only via MODULE_COMMAND (no APPLY).
  if (
    input.selection.target.kind === "action" &&
    !input.selection.runInitFirst &&
    input.moduleCommand
  ) {
    let parked: ParkedLiveConfig | null = null;
    try {
      parked = await parkLiveConfig(input.client);
      await input.client.moduleCommand(input.moduleCommand, input.signal);
      return {
        ok: true,
        kind: "module_command",
        plan,
        capture,
        parked,
        restored: false,
        note: "Azione inviata (MODULE_COMMAND). Canvas invariato.",
      };
    } catch (err) {
      return {
        ok: false,
        kind: "command_failed",
        plan,
        capture,
        parked,
        restored: false,
        note: "MODULE_COMMAND fallito. Canvas invariato.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const invalidI2c = ops.some((op) => {
    if (op.type === "i2c_read") return op.len < 1 || op.len > 8;
    if (op.type === "i2c_write" || op.type === "i2c_write_read") {
      const bytes = op.type === "i2c_write" ? op.bytes : op.writeBytes;
      return (
        bytes.length > 8 ||
        bytes.some((b) => !/^(?:0x)?[0-9a-f]{1,2}$/i.test(b.trim())) ||
        (op.type === "i2c_write_read" && (op.readLen < 1 || op.readLen > 8))
      );
    }
    return false;
  });
  if (invalidI2c)
    return {
      ok: false,
      kind: "profile_failed",
      plan,
      capture,
      parked: null,
      restored: false,
      note: "Operazione I²C non valida: usa valori HEX costanti e al massimo 8 byte per transazione.",
    };

  const initOps =
    input.selection.runInitFirst || input.selection.target.kind === "init"
      ? phaseOps(input.draft, "init")
      : [];
  const bodyOps =
    input.selection.target.kind === "init"
      ? []
      : input.selection.target.kind === "task"
        ? phaseOps(input.draft, "sample")
        : actionOps(
            input.draft,
            input.selection.target.kind === "action"
              ? input.selection.target.commandId
              : undefined,
          );

  // Run the whole plan once in profile init during APPLY — no schedule/runtime.
  // (A schedule + start_runtime has produced INTERNAL_ERROR after VALIDATE ok.)
  const { profile, skipped } = recipePlanToTestProfile(
    input.draft,
    [...initOps, ...bodyOps],
    [],
  );

  let parked: ParkedLiveConfig;
  try {
    parked = await parkLiveConfig(input.client);
  } catch (err) {
    return {
      ok: false,
      kind: "apply_failed",
      plan,
      capture,
      parked: null,
      restored: false,
      note: "Impossibile leggere la config attiva (GET_CONFIG).",
      error: err instanceof Error ? err.message : String(err),
      skippedOps: skipped,
    };
  }

  if (input.cleanupTryProfiles) {
    try {
      await input.cleanupTryProfiles();
    } catch {
      // Best-effort: a full catalog should not block Testa.
    }
  }

  if (input.installProfile) {
    const installed = await input.installProfile(profile);
    if (!installed.ok) {
      return {
        ok: false,
        kind: "profile_failed",
        plan,
        capture,
        parked,
        restored: false,
        note: "Installazione profilo di prova fallita. Canvas invariato.",
        error: installed.error,
        skippedOps: skipped,
      };
    }
  }

  // Confirm the Core catalog actually has this id@version (APPLY validate uses find → -ENOENT → INTERNAL_ERROR).
  try {
    const listed = await input.client.getFullDeviceProfileList();
    const found = listed.some(
      (p) => p.profileId === profile.profileId && p.version === profile.version,
    );
    if (!found) {
      return {
        ok: false,
        kind: "profile_failed",
        plan,
        capture,
        parked,
        restored: false,
        note: "Profilo installato ma assente dal catalogo Core. Canvas invariato.",
        error: `${profile.profileId}@${profile.version} non trovato dopo INSTALL_DEVICE_PROFILE`,
        skippedOps: skipped,
      };
    }
  } catch (err) {
    return {
      ok: false,
      kind: "profile_failed",
      plan,
      capture,
      parked,
      restored: false,
      note: "Impossibile verificare il catalogo profili dopo l’install. Canvas invariato.",
      error: err instanceof Error ? err.message : String(err),
      skippedOps: skipped,
    };
  }

  const testAddr = (input.i2cAddress ?? 0x48) & 0x7f;
  const testBytes = buildRecipeTestConfigBytes({
    profileId: profile.profileId,
    profileVersion: profile.version,
    i2cAddress: testAddr,
    portId: input.portId,
    periodMs: null,
    parkedConfigBytes: parked.configBytes,
  });

  if (!testBytes) {
    return {
      ok: false,
      kind: "profile_failed",
      plan,
      capture,
      parked,
      restored: false,
      note: "Impossibile compilare la config di prova.",
      skippedOps: skipped,
    };
  }

  try {
    const validated = await input.client.validateConfig({ configBytes: testBytes });
    if (!validated.valid) {
      return {
        ok: false,
        kind: "apply_failed",
        plan,
        capture,
        parked,
        restored: false,
        note: "Config di prova rifiutata da VALIDATE_CONFIG (nessuna modifica applicata). Canvas invariato.",
        error: formatValidateConfigFailure(validated),
        skippedOps: skipped,
      };
    }
  } catch (err) {
    return {
      ok: false,
      kind: "apply_failed",
      plan,
      capture,
      parked,
      restored: false,
      note: "VALIDATE_CONFIG fallita. Canvas invariato.",
      error: err instanceof Error ? err.message : String(err),
      skippedOps: skipped,
    };
  }

  // Fresh generation after install/validate — avoid ESTALE if anything else touched Config.
  // Keep the original parked snapshot for restore (do not replace configBytes with a
  // post-release empty config).
  let expectedGeneration = parked.generation;
  const parkedForRestore = parked;
  try {
    const fresh = await input.client.getConfig();
    expectedGeneration = fresh.generation;
  } catch {
    // Keep the original parked generation.
  }

  let applied = false;
  try {
    if (input.draft.binding.bus === "i2c") {
      try {
        const physical = await ensureRecipeTestI2cPhysical(input.client, {
          parkedConfigBytes: parkedForRestore.configBytes,
          expectedGeneration,
          preferredModes: input.preferredPhysicalModes,
          preferredI2cSpeed: input.preferredI2cSpeed,
          preferredSettings: input.preferredPhysicalSettings,
          signal: input.signal,
        });
        expectedGeneration = physical.generation;
      } catch (physErr) {
        const raw = physErr instanceof Error ? physErr.message : String(physErr);
        return {
          ok: false,
          kind: "apply_failed",
          plan,
          capture,
          parked: parkedForRestore,
          restored: false,
          note: "Impossibile preparare SDA/SCL sul Port 0 prima della prova. Canvas invariato.",
          error:
            raw +
            " — apri Cablaggio, posiziona SDA/SCL su Port 0 e premi Applica, poi riprova Testa.",
          skippedOps: skipped,
        };
      }
    }

    const response = await input.client.applyConfig({
      expectedGeneration,
      configBytes: testBytes,
    });
    const measured: Record<string, number[]> = {};
    let readIndex = 0;
    for (const op of ops) {
      const lengths =
        op.type === "i2c_read"
          ? [op.len]
          : op.type === "i2c_write_read"
            ? [op.readLen]
            : op.type === "i2c_transaction"
              ? op.phases.filter((p) => p.kind === "read").map((p) => p.len)
              : [];
      for (const length of lengths) {
        const bytes = response?.rxReads?.[readIndex++];
        if (bytes && bytes.length === length) (measured[op.id] ??= []).push(...bytes);
      }
    }
    const measuredCapture = buildRecipeBusCapture(ops, measured);
    applied = true;
    // Ops ran during APPLY. Restore is another persistent Config write,
    // so it must respect the firmware write interval even for write-only tests.
    await sleep(Math.max(CONFIG_WRITE_GAP_MS, input.sampleWaitMs ?? 0), input.signal);
    await restoreParkedConfig(input.client, parkedForRestore);
    return {
      ok: true,
      kind: "applied",
      plan,
      capture: measuredCapture,
      rxTruncated: response?.rxTruncated,
      readResults: evaluateRecipeReadResults(
        input.draft,
        ops,
        measuredCapture.rxByOpId,
      ),
      parked: parkedForRestore,
      restored: true,
      note: "Prova eseguita sulla Backbone (config temporanea applicata e ripristinata). Canvas invariato.",
      skippedOps: skipped,
    };
  } catch (err) {
    let restored = false;
    try {
      // Respect write-interval before restore if APPLY partially persisted.
      await sleep(CONFIG_WRITE_GAP_MS, input.signal);
      await restoreParkedConfig(input.client, parkedForRestore);
      restored = true;
    } catch (restoreErr) {
      if (applied) {
        return {
          ok: false,
          kind: "restore_failed",
          plan,
          capture,
          parked: parkedForRestore,
          restored: false,
          note: "Prova fallita e ripristino config non riuscito.",
          error:
            (err instanceof Error ? err.message : String(err)) +
            " · restore: " +
            (restoreErr instanceof Error ? restoreErr.message : String(restoreErr)),
          skippedOps: skipped,
        };
      }
    }
    const raw = err instanceof Error ? err.message : String(err);
    const addrHint = `0x${testAddr.toString(16).padStart(2, "0")}`;
    const hint = /BUSY/i.test(raw)
      ? " — Core occupato (intervallo minimo tra APPLY_CONFIG ≈1s). Riprova tra un secondo."
      : /INTERNAL_ERROR/i.test(raw)
        ? ` — APPLY_CONFIG non completato. Il solo INTERNAL_ERROR non identifica la causa; verifica la fase e il codice errno se presenti. Indirizzo di prova ${addrHint}.`
        : /UNSUPPORTED/i.test(raw)
          ? " — la Port scelta non espone I²C (usa Port 0 con SDA/SCL)."
          : "";
    return {
      ok: false,
      kind: "apply_failed",
      plan,
      capture,
      parked: parkedForRestore,
      restored,
      note: restored
        ? "Prova fallita; config precedente ripristinata. Canvas invariato."
        : "Prova fallita. Canvas invariato.",
      error: raw + hint,
      skippedOps: skipped,
    };
  }
}
