import type { DeviceRecipeDraft, DeviceRecipeOp, GpioSignalDef } from "./device-recipe-draft.js";
import {
  gpioOperationDefinition,
  gpioSignalType,
  type GpioCapabilityRequirement,
} from "./gpio-operation-registry.js";

/**
 * Declared hardware requirements for a logical GPIO signal.
 * Physical assignment and multiplexer routing stay in Hardware Configuration.
 */
export function gpioSignalCapabilityRequirements(
  signal: GpioSignalDef,
): readonly GpioCapabilityRequirement[] {
  const type = gpioSignalType(signal);
  if (type === "digital_input") {
    return signal.configuration?.edge && signal.configuration.edge !== "none"
      ? ["digital_read"]
      : ["digital_read"];
  }
  if (type === "digital_output") return ["digital_write"];
  if (type === "analog_input") return ["adc"];
  return ["pwm", "continuous_route"];
}

export type GpioAssignedPath = {
  readonly digitalRead?: boolean;
  readonly digitalWrite?: boolean;
  readonly adc?: boolean;
  readonly pwm?: boolean;
  readonly continuousRoute?: boolean;
  readonly timedOutput?: boolean;
};

export type GpioHardwareCapabilityContext = {
  /** Optional map of logical signal id → assigned physical path. Absent = unassigned. */
  readonly assigned?: Readonly<Record<string, GpioAssignedPath>>;
};

export type GpioCapabilityIssue = {
  readonly signalId: string;
  readonly signalName: string;
  readonly code:
    | "unassigned"
    | "incompatible"
    | "unsupported_pwm"
    | "unsupported_adc"
    | "needs_dedicated_route";
  readonly message: string;
};

function pathSatisfies(
  path: GpioAssignedPath | undefined,
  requirement: GpioCapabilityRequirement,
): boolean {
  if (!path) return false;
  switch (requirement) {
    case "digital_read":
      return path.digitalRead === true;
    case "digital_write":
      return path.digitalWrite === true;
    case "adc":
      return path.adc === true;
    case "pwm":
      return path.pwm === true;
    case "continuous_route":
      return path.continuousRoute === true;
    case "timed_output":
      return path.timedOutput === true || path.digitalWrite === true;
  }
}

/** Evaluate signal requirements against optional physical assignments. Editor stays usable without hardware. */
export function evaluateGpioCapabilities(
  draft: Pick<DeviceRecipeDraft, "binding">,
  context: GpioHardwareCapabilityContext = {},
): { readonly ok: boolean; readonly issues: readonly GpioCapabilityIssue[] } {
  const issues: GpioCapabilityIssue[] = [];
  for (const signal of draft.binding.gpioSignals) {
    const requirements = gpioSignalCapabilityRequirements(signal);
    const assigned = context.assigned?.[signal.id];
    if (!assigned) {
      issues.push({
        signalId: signal.id,
        signalName: signal.name,
        code: "unassigned",
        message: `${signal.name}: nessuna rotta fisica assegnata`,
      });
      continue;
    }
    for (const requirement of requirements) {
      if (pathSatisfies(assigned, requirement)) continue;
      issues.push({
        signalId: signal.id,
        signalName: signal.name,
        code:
          requirement === "pwm"
            ? "unsupported_pwm"
            : requirement === "adc"
              ? "unsupported_adc"
              : requirement === "continuous_route"
                ? "needs_dedicated_route"
                : "incompatible",
        message: `${signal.name}: la rotta assegnata non soddisfa ${requirement}`,
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

export type GpioTestSupport = {
  readonly executable: readonly DeviceRecipeOp["type"][];
  readonly representationOnly: readonly DeviceRecipeOp["type"][];
  readonly notes: readonly string[];
};

/** What the current firmware Device Profile can actually run for this driver. */
export function describeGpioTestSupport(
  draft: Pick<DeviceRecipeDraft, "binding" | "commands" | "phases">,
): GpioTestSupport {
  const executable = new Set<DeviceRecipeOp["type"]>();
  const representationOnly = new Set<DeviceRecipeOp["type"]>();
  const notes: string[] = [];
  const ops: DeviceRecipeOp[] = [
    ...draft.phases.init,
    ...draft.commands.flatMap((command) => command.steps),
  ];
  for (const op of ops) {
    const definition = gpioOperationDefinition(op.type);
    if (!definition) continue;
    if (definition.runtime === "supported") executable.add(op.type);
    else representationOnly.add(op.type);
  }
  if (draft.binding.gpioSignals.length > 1)
    notes.push(
      "Il profilo di prova GPIO/ADC opera su una sola porta: i driver multi-segnale restano rappresentati, non eseguiti in parallelo.",
    );
  if (representationOnly.size)
    notes.push(
      "PWM, impulsi, toggle e antirimbalzo restano dichiarativi finché il backend non espone opcode dedicati.",
    );
  return {
    executable: [...executable],
    representationOnly: [...representationOnly],
    notes,
  };
}
