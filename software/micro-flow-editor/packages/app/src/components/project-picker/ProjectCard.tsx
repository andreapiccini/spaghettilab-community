import { motion } from "motion/react";
import { motionTokens } from "../../lib/motion-tokens.js";
import type { ProjectSummary } from "./ProjectPicker.js";

/** `ux/screens/S010-workspace-shell/visual.md` § Griglia progetti + `ui-behavior.md` § Hover e selezione di una card progetto. */
export function ProjectCard({
  project,
  coresLabel,
  onOpen,
}: {
  readonly project: ProjectSummary;
  readonly coresLabel: string;
  readonly onOpen: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileHover={{ y: -2, boxShadow: "var(--shadow-e2)" }}
      whileTap={{ scale: 0.98, transition: motionTokens.spring.snappy }}
      className="flex h-[140px] w-[240px] flex-col justify-between rounded-slmd border border-border bg-surface p-4 text-left shadow-e1"
    >
      <span className="font-body text-sm font-semibold text-ink">{project.name}</span>
      <span className="w-fit rounded-slpill bg-surface-raised px-2 py-0.5 font-body text-xs text-ink-muted">
        {coresLabel}
      </span>
    </motion.button>
  );
}
