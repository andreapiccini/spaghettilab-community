import type { SpaghettiClient } from "@spaghettilab/protocol-sdk";
import {
  describeDeviceOp,
  type DeviceRecipeDraft,
  type DeviceRecipeOp,
  type DeviceRecipePhase,
} from "./device-recipe-draft.js";
import { buildRecipeBusCapture, type RecipeBusCapture } from "./recipe-bus-capture.js";
import { buildRecipeTestConfigBytes, recipePlanToTestProfile } from "./recipe-to-test-profile.js";

/** What to execute once on the Backbone — never writes the Flow canvas. */
export type RecipeTestTarget =
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
};

function phaseOps(draft: DeviceRecipeDraft, phase: DeviceRecipePhase): readonly DeviceRecipeOp[] {
  return draft.phases[phase] ?? [];
}

function actionOps(draft: DeviceRecipeDraft, commandId?: string): readonly DeviceRecipeOp[] {
  if (draft.category === "display" && draft.commands.length > 0) {
    const cmd =
      (commandId ? draft.commands.find((c) => c.id === commandId) : undefined) ?? draft.commands[0];
    return cmd?.steps ?? [];
  }
  return phaseOps(draft, "command");
}

/**
 * Flatten Init (optional) + one of Task / Action into an ordered plan.
 * Does not touch project / canvas state.
 */
export function buildRecipeTestPlan(
  draft: DeviceRecipeDraft,
  selection: RecipeTestSelection,
  labels: { readonly init: string; readonly task: string; readonly action: string },
): RecipeTestPlan {
  const steps: RecipeTestPlanStep[] = [];

  if (selection.runInitFirst) {
    for (const op of phaseOps(draft, "init")) {
      steps.push({
        phase: "init",
        phaseLabel: labels.init,
        op,
        description: describeDeviceOp(op),
      });
    }
  }

  if (selection.target.kind === "task") {
    for (const op of phaseOps(draft, "sample")) {
      steps.push({
        phase: "sample",
        phaseLabel: labels.task,
        op,
        description: describeDeviceOp(op),
      });
    }
  } else {
    const cmdId = selection.target.commandId;
    const cmd = cmdId ? draft.commands.find((c) => c.id === cmdId) : undefined;
    const actionLabel = cmd ? `${labels.action}: ${cmd.label || cmd.name}` : labels.action;
    for (const op of actionOps(draft, cmdId)) {
      steps.push({
        phase: draft.category === "display" ? "command_named" : "command",
        phaseLabel: actionLabel,
        op,
        description: describeDeviceOp(op),
      });
    }
  }

  return { selection, steps };
}

/** Snapshot live Backbone config — canvas / project are never modified. */
export async function parkLiveConfig(client: SpaghettiClient): Promise<ParkedLiveConfig> {
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
  readonly labels: { readonly init: string; readonly task: string; readonly action: string };
  /** Optional MODULE_COMMAND when Action maps to an already-deployed module. */
  readonly moduleCommand?: { readonly key: number; readonly commandId: number };
  readonly installProfile?: (draft: import("@spaghettilab/device-profile-authoring-model").DeviceProfileDraft) => Promise<{
    ok: boolean;
    error?: string;
  }>;
  readonly i2cAddress?: number;
  readonly portId?: number;
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
export async function runRecipeHardwareTest(
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

  const initOps = input.selection.runInitFirst ? phaseOps(input.draft, "init") : [];
  const bodyOps =
    input.selection.target.kind === "task"
      ? phaseOps(input.draft, "sample")
      : actionOps(input.draft, input.selection.target.kind === "action" ? input.selection.target.commandId : undefined);

  const { profile, skipped } = recipePlanToTestProfile(input.draft, initOps, bodyOps);

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

  const testBytes = buildRecipeTestConfigBytes({
    profileId: profile.profileId,
    i2cAddress: input.i2cAddress,
    portId: input.portId,
    periodMs: 150,
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

  let applied = false;
  try {
    await input.client.applyConfig({
      expectedGeneration: parked.generation,
      configBytes: testBytes,
    });
    applied = true;
    await sleep(input.sampleWaitMs ?? 400, input.signal);
    await restoreParkedConfig(input.client, parked);
    return {
      ok: true,
      kind: "applied",
      plan,
      capture,
      parked,
      restored: true,
      note: "Prova eseguita sulla Backbone (config temporanea applicata e ripristinata). Canvas invariato.",
      skippedOps: skipped,
    };
  } catch (err) {
    let restored = false;
    if (applied) {
      try {
        await restoreParkedConfig(input.client, parked);
        restored = true;
      } catch (restoreErr) {
        return {
          ok: false,
          kind: "restore_failed",
          plan,
          capture,
          parked,
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
    return {
      ok: false,
      kind: "apply_failed",
      plan,
      capture,
      parked,
      restored,
      note: restored
        ? "Prova fallita; config precedente ripristinata. Canvas invariato."
        : "Prova fallita. Canvas invariato.",
      error: err instanceof Error ? err.message : String(err),
      skippedOps: skipped,
    };
  }
}
