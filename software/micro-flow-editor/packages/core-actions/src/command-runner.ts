import type { DomainError, PermissionScope, PermissionSet } from "@spaghettilab/domain";
import { checkPermission } from "@spaghettilab/domain";
import { CoreActionsErrorCode, classifyWireError, wireFailure } from "./wire-error.js";

/** The narrow slice of `SpaghettiClient` this runner calls. */
export type CommandWireClient = {
  moduleCommand(req: { readonly key: number; readonly commandId: number }): Promise<void>;
};

export const CommandOutcomeKind = {
  SUCCESS: "SUCCESS",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  QUEUE_FULL: "QUEUE_FULL",
  TIMEOUT: "TIMEOUT",
  UNSUPPORTED_ARGUMENTS: "UNSUPPORTED_ARGUMENTS",
  REMOTE_ERROR: "REMOTE_ERROR",
} as const;
export type CommandOutcomeKind = (typeof CommandOutcomeKind)[keyof typeof CommandOutcomeKind];

export type CommandOutcome = {
  readonly kind: CommandOutcomeKind;
  readonly issues: readonly DomainError[];
};

export type RunCommandRequest = {
  readonly moduleKey: number;
  readonly commandId: number;
  readonly permissionScope?: PermissionScope;
  /**
   * `MODULE_COMMAND` (`firmware/backbone/subsys/communication/operations/module_command.c`,
   * mirrored in `@spaghettilab/protocol-sdk`'s `ModuleCommandRequest`) has no
   * argument field on the wire at all today — set this `true` when the
   * command being invoked genuinely needs parameters, so this function
   * refuses up front (`UNSUPPORTED_ARGUMENTS`) instead of silently invoking
   * the command without them. A typed argument-entry form can still exist
   * client-side for when the wire eventually supports it; this is the one
   * place that stays honest about it not doing so yet.
   */
  readonly requiresArguments?: boolean;
};

/**
 * Runs one immediate Module command — explicitly and structurally distinct
 * from any Config mutation (S092 § Verifiche: "l'esecuzione di un comando
 * manuale non modifica Config o progetto"): this function never touches
 * `ProjectV1`, never goes through `CommandStack`, and the wire operation it
 * calls (`MODULE_COMMAND`) is not `APPLY_CONFIG` — there is no code path
 * here that could accidentally persist anything.
 */
export async function runCommand(
  client: CommandWireClient,
  granted: PermissionSet,
  req: RunCommandRequest,
): Promise<CommandOutcome> {
  const scope = req.permissionScope ?? "core.command.execute";
  const permission = checkPermission(granted, scope);
  if (!permission.ok) {
    return { kind: CommandOutcomeKind.PERMISSION_DENIED, issues: [permission.error] };
  }

  if (req.requiresArguments) {
    return {
      kind: CommandOutcomeKind.UNSUPPORTED_ARGUMENTS,
      issues: [
        wireFailure(
          CoreActionsErrorCode.UNSUPPORTED_ARGUMENTS,
          ["core-actions", "runCommand"],
          String(req.commandId),
          `MODULE_COMMAND has no argument field on the wire — command ${req.commandId} needs arguments this call cannot send`,
        ),
      ],
    };
  }

  try {
    await client.moduleCommand({ key: req.moduleKey, commandId: req.commandId });
    return { kind: CommandOutcomeKind.SUCCESS, issues: [] };
  } catch (cause) {
    const classified = classifyWireError(cause);
    return {
      kind: CommandOutcomeKind[classified],
      issues: [wireFailure(CoreActionsErrorCode[classified], ["core-actions", "runCommand"], String(req.commandId), `moduleCommand failed: ${classified}`, cause)],
    };
  }
}
