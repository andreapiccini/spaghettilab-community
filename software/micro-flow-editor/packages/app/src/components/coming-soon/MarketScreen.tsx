import { Boxes, Cpu, ShoppingBag, type LucideIcon } from "lucide-react";
import { ComingSoonScreen } from "./ComingSoonScreen.js";

type MarketCategory = {
  readonly id: "software" | "hardware";
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
};

const CATEGORIES: readonly MarketCategory[] = [
  {
    id: "software",
    icon: Boxes,
    title: "Moduli software",
    body: "Flow, blocchi di elaborazione, pack e estensioni da aggiungere al progetto.",
  },
  {
    id: "hardware",
    icon: Cpu,
    title: "Moduli hardware",
    body: "Schede, sensori e moduli fisici compatibili con i Core già collegati.",
  },
];

/**
 * Store-facing Market (software + hardware). Distinct from the existing
 * Capability Marketplace & OTA screen, which stays the advanced pack/OTA tool.
 */
export function MarketScreen() {
  return (
    <ComingSoonScreen
      icon={ShoppingBag}
      title="Market"
      description="Qui potrai acquistare e aggiungere moduli al progetto. Due cataloghi restano distinti: software (flow e pack) e hardware (schede e sensori). Nessun checkout per ora."
    >
      <div className="mt-6 grid max-w-3xl gap-3 sm:grid-cols-2">
        {CATEGORIES.map((category) => {
          const Icon = category.icon;
          return (
            <article
              key={category.id}
              className="rounded-slmd border border-border bg-surface p-4 shadow-e1"
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-slsm"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-brand-blue) 12%, transparent)",
                }}
              >
                <Icon size={20} className="text-brand-blue" />
              </div>
              <h2 className="mt-3 font-heading text-base font-semibold text-ink">
                {category.title}
              </h2>
              <p className="mt-1 font-body text-sm text-ink-muted">{category.body}</p>
              <p className="mt-3 font-body text-xs text-ink-faint">
                Catalogo riservato — Coming soon
              </p>
            </article>
          );
        })}
      </div>
      <p className="mt-6 max-w-2xl font-body text-xs text-ink-faint">
        I Capability Pack e l&apos;OTA restano in Capability Marketplace, in modalità
        avanzata.
      </p>
    </ComingSoonScreen>
  );
}
