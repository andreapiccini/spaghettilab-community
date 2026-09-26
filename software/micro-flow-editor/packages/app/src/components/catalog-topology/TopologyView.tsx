import type { FlowEntry, FunctionBayEntry, TopologyIndex } from "@spaghettilab/catalog-model";
import { ChevronDown, Layers, Plug, Waypoints } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { catalogTopologyCopy } from "../../lib/catalog-topology-copy.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import { useLocale } from "../../state/locale-context.js";

/**
 * `ux/screens/S040-catalog-topology/visual.md` § Vista Topologia. La gerarchia reale
 * disponibile è Flow → Function Bay → rail — non esiste una riga Port a sé stante nel
 * modello normalizzato (`TopologyIndex.ports` è solo l'insieme dei `portId`
 * referenziati dai Flow, senza nome/segnale) e nessuno dei cinque segnali
 * ("PWM"/"ADC"/...) o della stringa `ENFORCED`/`UNVERIFIED` esiste come tipo reale —
 * `direction`/`signalCount`/`admission`/`assurance` sono interi grezzi passati
 * intatti dal Core (`@spaghettilab/catalog-model`'s own doc comment: "mai
 * normalizzato/coerced"). Questa vista mostra quei valori come codici grezzi
 * etichettati, non li traduce in un vocabolario che il protocollo non fornisce.
 */
export function TopologyView({ topology }: { readonly topology: TopologyIndex }) {
  const { locale } = useLocale();
  const copy = catalogTopologyCopy(locale);
  if (topology.flows.length === 0) {
    return <p className="p-6 font-body text-sm text-ink-faint">{copy.noFlow}</p>;
  }

  return (
    <div className="flex flex-col gap-1 p-6">
      {topology.flows.map((flow) => (
        <FlowRow key={flow.flowId} flow={flow} />
      ))}
    </div>
  );
}

function FlowRow({ flow }: { readonly flow: FlowEntry }) {
  const { locale } = useLocale();
  const copy = catalogTopologyCopy(locale);
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-11 w-full items-center gap-2 rounded-slsm px-2 text-left hover:bg-surface-raised">
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={motionTokens.duration.base}>
          <ChevronDown size={14} className="text-ink-faint" />
        </motion.span>
        <Waypoints size={16} className="text-ink-muted" />
        <span className="font-body text-sm font-semibold text-ink">Flow {flow.flowId}</span>
        <span className="font-mono text-xs text-ink-faint">port {flow.portId} · {copy.directionPrefix} {flow.direction} · {copy.signals(flow.signalCount)}</span>
        <span className="ml-auto font-body text-xs text-ink-faint">{flow.bays.length} Bay</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={motionTokens.duration.base} className="overflow-hidden border-l border-border pl-4" style={{ marginLeft: 20 }}>
            {flow.bays.length === 0 ? (
              <p className="py-2 font-body text-xs text-ink-faint">{copy.noFunctionBay}</p>
            ) : (
              flow.bays.map((bay) => <BayRow key={bay.bayId} bay={bay} />)
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BayRow({ bay }: { readonly bay: FunctionBayEntry }) {
  const { locale } = useLocale();
  const copy = catalogTopologyCopy(locale);
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-10 w-full items-center gap-2 rounded-slsm px-2 text-left hover:bg-surface-raised">
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={motionTokens.duration.base}>
          <ChevronDown size={12} className="text-ink-faint" />
        </motion.span>
        <Layers size={14} className="text-ink-muted" />
        <span className="font-body text-sm text-ink">Bay {bay.ordinal}</span>
        <span className="font-mono text-xs text-ink-faint">
          modulo {bay.moduleKey === 0 ? copy.moduleNone : bay.moduleKey} · admission {bay.admission}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={motionTokens.duration.base} className="overflow-hidden border-l border-border pl-4" style={{ marginLeft: 18 }}>
            {bay.rails.length === 0 ? (
              <p className="py-2 font-body text-xs text-ink-faint">{copy.noRail}</p>
            ) : (
              bay.rails.map((rail) => (
                <div key={rail.railId} className="flex h-9 items-center gap-2 px-2">
                  <Plug size={14} className="text-ink-faint" />
                  <span className="font-body text-sm text-ink">Rail {rail.railId}</span>
                  <span className="rounded-slpill px-2 py-0.5 font-mono text-[11px]" style={{ backgroundColor: "color-mix(in srgb, var(--color-ink-faint) 12%, transparent)", color: "var(--color-ink-muted)" }}>
                    assurance: {rail.assurance}
                  </span>
                  <span className="font-mono text-xs text-ink-faint">max {rail.maxTotalMicroamps}µA</span>
                </div>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
