import type { TopologyIndex } from "@spaghettilab/catalog-model";
import type { GraphNode } from "@spaghettilab/domain";
import { previewDiscoveryAccept, previewDiscoveryAcceptDiff, type DiscoveryAcceptChoice, type ElectricalMode, type PhysicalCompositionNodeData } from "@spaghettilab/physical-composition-model";
import type { DiscoveryCandidate } from "@spaghettilab/protocol-sdk";
import { Radar, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { motionTokens } from "../../lib/motion-tokens.js";
import { physicalCompositionCopy } from "../../lib/physical-composition-copy.js";
import { useLocale } from "../../state/locale-context.js";

const CONFIDENCE_LABEL = (c: number): { readonly label: string; readonly colorVar: string } => (c >= 80 ? { label: "Alta", colorVar: "var(--color-success)" } : c >= 40 ? { label: "Media", colorVar: "var(--color-warning)" } : { label: "Bassa", colorVar: "var(--color-error)" });

/**
 * `ux/screens/S050-physical-composition/visual.md` § Tray "Candidati rilevati".
 * No "authority" badge (e.g. "dichiarato dal Core" vs "euristica di discovery") is
 * shown — `DiscoveryCandidate` (`protocol-sdk`) has no such field, only a raw
 * `confidence: number`. A documented gap, not an invented distinction.
 */
export function DiscoveryTray({
  open,
  candidates,
  topology,
  existingNodes,
  onAccept,
  onReject,
  onClose,
  onConfigureManually,
}: {
  readonly open: boolean;
  readonly candidates: readonly DiscoveryCandidate[];
  readonly topology: TopologyIndex | null;
  readonly existingNodes: readonly GraphNode<"physical-composition", string, PhysicalCompositionNodeData>[];
  readonly onAccept: (candidate: DiscoveryCandidate, choice: DiscoveryAcceptChoice) => void;
  readonly onReject: (candidateId: number) => void;
  readonly onClose: () => void;
  readonly onConfigureManually?: (portId?: number) => void;
}) {
  const { locale } = useLocale();
  const copy = physicalCompositionCopy(locale);
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ x: 360 }} animate={{ x: 0 }} exit={{ x: 360 }} transition={motionTokens.spring.smooth} className="flex h-full w-[360px] flex-col border-l border-border bg-surface shadow-e2">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <h2 className="font-heading text-sm font-semibold text-ink">{copy.recognizedHardware}</h2>
            <button type="button" onClick={onClose} className="ml-auto flex h-8 w-8 items-center justify-center rounded-slsm text-ink-faint hover:bg-surface-raised">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-3">
            {candidates.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Radar size={40} className="text-ink-faint" />
                <p className="font-body text-sm text-ink-muted">{copy.noHardware}</p>
                <p className="max-w-[240px] font-body text-xs text-ink-faint">{copy.noHardwareHint}</p>
                {onConfigureManually && (
                  <button type="button" onClick={() => onConfigureManually()} className="h-9 rounded-slsm bg-brand-blue px-4 font-body-strong text-sm text-white hover:bg-brand-blue-dark">
                    {copy.configureManually}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {candidates.map((c) => (
                  <CandidateCard key={c.id} candidate={c} topology={topology} existingNodes={existingNodes} onAccept={onAccept} onReject={onReject} />
                ))}
                {onConfigureManually && (
                  <button type="button" onClick={() => onConfigureManually()} className="h-9 rounded-slsm border border-border-strong font-body text-sm text-ink hover:bg-surface-raised">
                    Non è nessuno di questi — configura a mano
                  </button>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CandidateCard({
  candidate,
  topology,
  existingNodes,
  onAccept,
  onReject,
}: {
  readonly candidate: DiscoveryCandidate;
  readonly topology: TopologyIndex | null;
  readonly existingNodes: readonly GraphNode<"physical-composition", string, PhysicalCompositionNodeData>[];
  readonly onAccept: (candidate: DiscoveryCandidate, choice: DiscoveryAcceptChoice) => void;
  readonly onReject: (candidateId: number) => void;
}) {
  const flow = topology?.flows.find((f) => f.portId === candidate.portId);
  const firstBay = flow?.bays[0];
  const [key, setKey] = useState(candidate.id);
  const [bayId, setBayId] = useState(firstBay?.bayId ?? -1);
  const [railId, setRailId] = useState(firstBay?.rails[0]?.railId ?? -1);
  const [electricalMode, setElectricalMode] = useState<ElectricalMode>("input-output");
  const confidence = CONFIDENCE_LABEL(candidate.confidence);

  const choice: DiscoveryAcceptChoice = { key, bayId, railId, electricalMode };
  const preview = previewDiscoveryAccept(candidate, choice);
  const diff = topology ? previewDiscoveryAcceptDiff(existingNodes, preview, topology) : null;

  return (
    <motion.div layout whileHover={{ boxShadow: "var(--shadow-e2)" }} className="rounded-slmd border border-border p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-body text-sm font-semibold text-ink">{candidate.suggestedTypeId}</div>
          <div className="font-body text-xs text-ink-faint">Port {candidate.portId}</div>
        </div>
        <span className="rounded-slpill px-2 py-0.5 font-body text-xs" style={{ backgroundColor: `color-mix(in srgb, ${confidence.colorVar} 12%, transparent)`, color: confidence.colorVar }}>
          {confidence.label} ({candidate.confidence})
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <input type="number" value={key} onChange={(e) => setKey(Number(e.target.value))} title="Module key proposto" className="w-20 rounded-slsm border border-border-strong px-2 py-1 font-mono text-xs outline-none" />
        <select value={bayId} onChange={(e) => setBayId(Number(e.target.value))} className="rounded-slsm border border-border-strong px-2 py-1 font-mono text-xs outline-none">
          {(flow?.bays ?? []).map((b) => (
            <option key={b.bayId} value={b.bayId}>
              Bay {b.ordinal}
            </option>
          ))}
        </select>
        <select value={railId} onChange={(e) => setRailId(Number(e.target.value))} className="rounded-slsm border border-border-strong px-2 py-1 font-mono text-xs outline-none">
          {(flow?.bays.find((b) => b.bayId === bayId)?.rails ?? []).map((r) => (
            <option key={r.railId} value={r.railId}>
              Rail {r.railId}
            </option>
          ))}
        </select>
        <select value={electricalMode} onChange={(e) => setElectricalMode(e.target.value as ElectricalMode)} className="rounded-slsm border border-border-strong px-2 py-1 font-mono text-xs outline-none">
          <option value="input-only">input-only</option>
          <option value="output-only">output-only</option>
          <option value="input-output">input-output</option>
        </select>
      </div>

      <div className="mt-2 rounded-slsm bg-surface-sunken p-2 font-mono text-xs text-ink-muted">
        + Module su Port {candidate.portId}, Bay {bayId}, Rail {railId}
        {diff && !diff.ok && (
          <div className="mt-1 text-error">{diff.error[0]?.remediation}</div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => onReject(candidate.id)} className="h-9 flex-1 rounded-slsm border border-border-strong font-body text-sm text-ink hover:bg-surface-raised">
          Rifiuta
        </button>
        <button type="button" onClick={() => onAccept(candidate, choice)} disabled={!topology || (diff !== null && !diff.ok) || bayId === -1 || railId === -1} className="h-9 flex-1 rounded-slsm bg-brand-blue font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:opacity-50">
          Accetta
        </button>
      </div>
    </motion.div>
  );
}
