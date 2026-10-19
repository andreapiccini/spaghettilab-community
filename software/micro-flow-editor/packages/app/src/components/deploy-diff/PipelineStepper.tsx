import { DeploymentOutcomeKind, type DeploymentResult } from "@spaghettilab/config-deployment";
import { Check, X } from "lucide-react";
import { motion } from "motion/react";
import { motionTokens } from "../../lib/motion-tokens.js";

type StageState = "pending" | "success" | "error";

const STAGES = ["Compila", "Valida locale", "Risolvi artifact", "Valida remota", "Applica (CAS)", "Verifica read-back"] as const;

/**
 * `@spaghettilab/config-deployment`'s `deployConfig()` runs all six stages in one
 * atomic call with no per-stage callback — this package genuinely cannot report
 * real incremental progress (confirmed: no intermediate hook exists). This maps
 * the single final `DeploymentResult` back onto which of the six stages the
 * pipeline actually reached, using the outcome kind and (where the kind is
 * ambiguous between two stages) the issue's own code/target — never a fabricated
 * live per-stage progress.
 */
function stageStates(result: DeploymentResult | null): StageState[] {
  if (!result) return ["pending", "pending", "pending", "pending", "pending", "pending"];
  const remoteValidationFailed = result.issues.some((i) => i.code === "config-deployment.remote_validation_failed");
  const applyTarget = result.issues.find((i) => i.target === "applyConfig" || i.target?.startsWith("getConfig"))?.target;

  switch (result.outcome) {
    case DeploymentOutcomeKind.SUCCESS:
    case DeploymentOutcomeKind.NO_OP:
    case DeploymentOutcomeKind.AMBIGUOUS_RESOLVED_APPLIED:
      return ["success", "success", "success", "success", "success", "success"];
    case DeploymentOutcomeKind.PROFILE_OR_PACK_MISSING:
      return ["success", "success", "error", "pending", "pending", "pending"];
    case DeploymentOutcomeKind.VALIDATION_FAILED:
      return remoteValidationFailed ? ["success", "success", "success", "error", "pending", "pending"] : ["success", "error", "pending", "pending", "pending", "pending"];
    case DeploymentOutcomeKind.STALE_GENERATION:
      return ["success", "success", "success", "success", "error", "pending"];
    case DeploymentOutcomeKind.READBACK_MISMATCH:
      return ["success", "success", "success", "success", "success", "error"];
    case DeploymentOutcomeKind.AMBIGUOUS_RESOLVED_NOT_APPLIED:
      return ["success", "success", "success", "success", "error", "pending"];
    case DeploymentOutcomeKind.REMOTE_ERROR:
      if (applyTarget?.startsWith("getConfig")) return ["success", "success", "success", "success", "error", "pending"];
      return ["success", "success", "success", "error", "pending", "pending"];
    default:
      return ["pending", "pending", "pending", "pending", "pending", "pending"];
  }
}

export function PipelineStepper({ result, running }: { readonly result: DeploymentResult | null; readonly running: boolean }) {
  const states = stageStates(result);
  const detail = result?.issues[0]?.remediation;

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="grid grid-cols-6 items-start">
        {STAGES.map((label, i) => (
          <div key={label} className="flex min-w-0 flex-col items-center gap-1">
            <div className="flex w-full items-center">
              <div aria-hidden="true" className="h-0.5 flex-1" style={{ backgroundColor: i === 0 ? "transparent" : states[i - 1] === "success" ? "var(--color-success)" : "var(--color-border)" }} />
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={motionTokens.spring.snappy}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor: states[i] === "success" ? "var(--color-success)" : states[i] === "error" ? "var(--color-error)" : "var(--color-surface)",
                  border: states[i] === "pending" ? "1px solid var(--color-border)" : "none",
                }}
              >
                {states[i] === "success" && <Check size={14} className="text-white" />}
                {states[i] === "error" && <X size={14} className="text-white" />}
                {states[i] === "pending" && running && i === 0 && <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--color-info)" }} />}
              </motion.div>
              <div aria-hidden="true" className="h-0.5 flex-1" style={{ backgroundColor: i === STAGES.length - 1 ? "transparent" : states[i] === "success" ? "var(--color-success)" : "var(--color-border)" }} />
            </div>
            <span className="w-full px-1 text-center font-body text-xs leading-4 text-ink-faint">{label}</span>
          </div>
        ))}
      </div>
      {detail && <p className="font-body text-sm text-ink-muted">{detail}</p>}
      {running && <p className="font-body text-sm text-ink-muted">Deploy in corso — nessun progresso incrementale reale per singola tappa (chiamata atomica).</p>}
    </div>
  );
}
