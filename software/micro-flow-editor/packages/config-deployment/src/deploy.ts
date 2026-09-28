import { domainError, type DeploymentId, type DeploymentRecordV1, type DomainError } from "@spaghettilab/domain";
import {
  encodeConfigCbor,
  sha256,
  type CanonicalConfig,
  type CompileConfigInput,
  type CompileConfigOptions,
} from "@spaghettilab/config-compiler";
import { decodeConfigCbor, dryRunConfig, type DryRunOptions } from "@spaghettilab/config-decompiler";
import { ConfigDeploymentErrorCode } from "./errors.js";
import { diffConfigs, type ConfigDiff } from "./diff.js";

type GetConfigResponse = { readonly generation: number; readonly sha256: Uint8Array; readonly configBytes: Uint8Array };
type ValidateConfigResponse = { readonly valid: true } | { readonly valid: false; readonly failureField: number; readonly failureIndex: number; readonly failureReason: number };
type ApplyConfigResponse = { readonly changed: boolean; readonly generation: number; readonly sha256: Uint8Array };

/** The narrow slice of `@spaghettilab/protocol-sdk`'s `SpaghettiClient` this orchestrator calls — a real client satisfies this structurally, tests use a small hand-written fake. */
export type ConfigWireClient = {
  getConfig(): Promise<GetConfigResponse>;
  validateConfig(req: { readonly configBytes: Uint8Array }): Promise<ValidateConfigResponse>;
  applyConfig(req: { readonly expectedGeneration: number; readonly configBytes: Uint8Array }): Promise<ApplyConfigResponse>;
};

type WireError = { readonly code?: string; readonly status?: number };
function isProtocolError(e: unknown): e is WireError & { code: "PROTOCOL_ERROR"; status: number } {
  return typeof e === "object" && e !== null && (e as WireError).code === "PROTOCOL_ERROR" && typeof (e as WireError).status === "number";
}
/** `firmware/backbone/subsys/communication/protocol_status.c`: `-ESTALE`/`-EEXIST` → `CONFLICT` (4) — the same mapping `@spaghettilab/device-profile-install` uses. */
const STATUS_CONFLICT = 4;

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

export const DeploymentOutcomeKind = {
  SUCCESS: "SUCCESS",
  NO_OP: "NO_OP",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  PROFILE_OR_PACK_MISSING: "PROFILE_OR_PACK_MISSING",
  STALE_GENERATION: "STALE_GENERATION",
  AMBIGUOUS_RESOLVED_APPLIED: "AMBIGUOUS_RESOLVED_APPLIED",
  AMBIGUOUS_RESOLVED_NOT_APPLIED: "AMBIGUOUS_RESOLVED_NOT_APPLIED",
  READBACK_MISMATCH: "READBACK_MISMATCH",
  REMOTE_ERROR: "REMOTE_ERROR",
} as const;
export type DeploymentOutcomeKind = (typeof DeploymentOutcomeKind)[keyof typeof DeploymentOutcomeKind];

export type DeploymentContext = CompileConfigOptions &
  DryRunOptions & {
    readonly expectedGeneration: number;
    readonly sourceProjectHash: string;
    readonly target: string;
    readonly deploymentId: DeploymentId;
    readonly timestamp: string;
  };

export type DeploymentResult = {
  readonly outcome: DeploymentOutcomeKind;
  /** Present only for `SUCCESS`/`NO_OP`/`AMBIGUOUS_RESOLVED_APPLIED` — S080 point 5: "Mantieni DeploymentRecord soltanto dopo read-back con hash atteso." */
  readonly record?: DeploymentRecordV1;
  readonly issues: readonly DomainError[];
  /** Present for `STALE_GENERATION` — the live snapshot the caller needs to offer "import live / rebase / annulla" (S080 point 4). This function never auto-resolves a conflict. */
  readonly liveConfig?: CanonicalConfig;
  readonly diff?: ConfigDiff;
};

function record(context: DeploymentContext, response: ApplyConfigResponse | GetConfigResponse): DeploymentRecordV1 {
  return {
    deploymentId: context.deploymentId,
    target: context.target,
    timestamp: context.timestamp,
    sourceProjectHash: context.sourceProjectHash,
    configGeneration: response.generation,
    configHash: bytesToHex(response.sha256),
    outcome: "success",
  };
}

/**
 * Compiles, locally dry-runs (blocking on missing profile/pack — a harder
 * gate than `dryRunConfig`'s own warning-only treatment, per S080 point 3),
 * validates remotely, applies with compare-and-swap, and only records a
 * `DeploymentRecordV1` once a read-back `GET_CONFIG` confirms the expected
 * hash. Never assumes success or failure it hasn't observed (S080 point 7):
 * an ambiguous outcome (lost response, timeout) is always followed by a
 * `GET_CONFIG` reconciliation comparing the returned hash against the
 * candidate's own hash — "reboot durante apply viene riconciliato da boot
 * ID + Config hash" (the caller supplies boot-ID-based reboot detection via
 * `CoreSession`, S030; this function's own reconciliation is the Config-hash
 * half).
 */
export async function deployConfig(client: ConfigWireClient, input: CompileConfigInput, context: DeploymentContext): Promise<DeploymentResult> {
  const dryRun = dryRunConfig(input, context);

  const blockingProfileOrPack = dryRun.issues.filter(
    (i) => i.code === "config-decompiler.missing_profile" || i.code === "config-decompiler.missing_capability_pack",
  );
  if (blockingProfileOrPack.length > 0) {
    return { outcome: DeploymentOutcomeKind.PROFILE_OR_PACK_MISSING, issues: blockingProfileOrPack };
  }
  if (!dryRun.compiled) {
    return { outcome: DeploymentOutcomeKind.VALIDATION_FAILED, issues: dryRun.issues };
  }

  const candidate = dryRun.compiled;
  const candidateBytes = encodeConfigCbor(candidate);
  const candidateHash = await sha256(candidateBytes);

  let remoteValidation: ValidateConfigResponse;
  try {
    remoteValidation = await client.validateConfig({ configBytes: candidateBytes });
  } catch (cause) {
    return { outcome: DeploymentOutcomeKind.REMOTE_ERROR, issues: [remoteFailure("validateConfig", cause)] };
  }
  if (!remoteValidation.valid) {
    return {
      outcome: DeploymentOutcomeKind.VALIDATION_FAILED,
      issues: [
        domainError({
          code: ConfigDeploymentErrorCode.REMOTE_VALIDATION_FAILED,
          path: ["config-deployment", "validateConfig"],
          target: `field=${remoteValidation.failureField} index=${remoteValidation.failureIndex}`,
          remediation: `the Core rejected the compiled Config (reason code ${remoteValidation.failureReason})`,
        }),
      ],
    };
  }

  let applyResponse: ApplyConfigResponse;
  try {
    applyResponse = await client.applyConfig({ expectedGeneration: context.expectedGeneration, configBytes: candidateBytes });
  } catch (cause) {
    if (isProtocolError(cause) && cause.status === STATUS_CONFLICT) {
      return await resolveStaleGeneration(client, candidate);
    }
    return await reconcileAmbiguousApply(client, candidateHash, context, cause);
  }

  if (!applyResponse.changed) {
    return { outcome: DeploymentOutcomeKind.NO_OP, issues: [], record: record(context, applyResponse) };
  }

  // Read-back verify — never trust the apply response alone (S080 point 5).
  let readBack: GetConfigResponse;
  try {
    readBack = await client.getConfig();
  } catch (cause) {
    return { outcome: DeploymentOutcomeKind.REMOTE_ERROR, issues: [remoteFailure("getConfig (read-back)", cause)] };
  }
  if (readBack.generation !== applyResponse.generation || !bytesEqual(readBack.sha256, candidateHash)) {
    return {
      outcome: DeploymentOutcomeKind.READBACK_MISMATCH,
      issues: [
        domainError({
          code: ConfigDeploymentErrorCode.READBACK_MISMATCH,
          path: ["config-deployment", "readback"],
          target: bytesToHex(readBack.sha256),
          remediation: "the Core's read-back Config does not match what was applied — no DeploymentRecord was created",
        }),
      ],
    };
  }

  return { outcome: DeploymentOutcomeKind.SUCCESS, issues: [], record: record(context, applyResponse) };
}

async function resolveStaleGeneration(client: ConfigWireClient, candidate: CanonicalConfig): Promise<DeploymentResult> {
  let live: GetConfigResponse;
  try {
    live = await client.getConfig();
  } catch (cause) {
    return { outcome: DeploymentOutcomeKind.REMOTE_ERROR, issues: [remoteFailure("getConfig (conflict re-fetch)", cause)] };
  }
  const liveDecoded = decodeConfigCbor(live.configBytes);
  if (!liveDecoded.ok) {
    return { outcome: DeploymentOutcomeKind.REMOTE_ERROR, issues: [liveDecoded.error] };
  }
  return {
    outcome: DeploymentOutcomeKind.STALE_GENERATION,
    issues: [
      domainError({
        code: ConfigDeploymentErrorCode.STALE_GENERATION,
        path: ["config-deployment", "applyConfig"],
        target: String(live.generation),
        remediation: "the Core's Config changed since this candidate was prepared — the candidate is untouched; choose import-live, rebase, or cancel",
      }),
    ],
    liveConfig: liveDecoded.value,
    diff: diffConfigs(liveDecoded.value, candidate),
  };
}

async function reconcileAmbiguousApply(
  client: ConfigWireClient,
  candidateHash: Uint8Array,
  context: DeploymentContext,
  cause: unknown,
): Promise<DeploymentResult> {
  let live: GetConfigResponse;
  try {
    live = await client.getConfig();
  } catch (getCause) {
    // Reconciliation itself failed — genuinely unknown state, never guessed.
    return { outcome: DeploymentOutcomeKind.REMOTE_ERROR, issues: [remoteFailure("applyConfig", cause), remoteFailure("getConfig (reconciliation)", getCause)] };
  }
  if (bytesEqual(live.sha256, candidateHash)) {
    return { outcome: DeploymentOutcomeKind.AMBIGUOUS_RESOLVED_APPLIED, issues: [], record: record(context, live) };
  }
  return { outcome: DeploymentOutcomeKind.AMBIGUOUS_RESOLVED_NOT_APPLIED, issues: [remoteFailure("applyConfig", cause)] };
}

function remoteFailure(operation: string, cause: unknown): DomainError {
  return domainError({
    code: ConfigDeploymentErrorCode.REMOTE_ERROR,
    path: ["config-deployment", operation],
    target: operation,
    remediation: "the remote call failed or was lost",
    cause,
  });
}

/**
 * Runs `deployConfig` against several Cores independently — S080 point 8:
 * "supporta deploy coordinato di più Core come operazioni indipendenti con
 * report parziale". A failure on one target never marks another target's
 * result as failed: each call is isolated in its own `try`/`catch`, and
 * the full array is always returned regardless of how many targets failed.
 */
export async function deployToCores(
  targets: readonly { readonly client: ConfigWireClient; readonly input: CompileConfigInput; readonly context: DeploymentContext }[],
): Promise<readonly { readonly target: string; readonly result: DeploymentResult }[]> {
  const results = await Promise.all(
    targets.map(async ({ client, input, context }) => {
      try {
        return { target: context.target, result: await deployConfig(client, input, context) };
      } catch (cause) {
        return { target: context.target, result: { outcome: DeploymentOutcomeKind.REMOTE_ERROR, issues: [remoteFailure("deployConfig", cause)] } };
      }
    }),
  );
  return results;
}
