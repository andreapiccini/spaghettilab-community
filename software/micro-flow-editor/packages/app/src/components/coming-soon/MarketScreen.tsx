import { Boxes, Cpu, ShoppingBag, type LucideIcon } from "lucide-react";
import { comingSoonCopy } from "../../lib/coming-soon-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { ComingSoonScreen } from "./ComingSoonScreen.js";

type MarketCategory = {
  readonly id: "software" | "hardware";
  readonly icon: LucideIcon;
};

const CATEGORIES: readonly MarketCategory[] = [
  { id: "software", icon: Boxes },
  { id: "hardware", icon: Cpu },
];

/**
 * Store-facing Market (software + hardware). Distinct from the existing
 * Capability Marketplace & OTA screen, which stays the advanced pack/OTA tool.
 */
export function MarketScreen() {
  const { locale } = useLocale();
  const copy = comingSoonCopy(locale);

  return (
    <ComingSoonScreen icon={ShoppingBag} title={copy.market.title} description={copy.market.description}>
      <div className="mt-6 grid max-w-3xl gap-3 sm:grid-cols-2">
        {CATEGORIES.map((category) => {
          const Icon = category.icon;
          const title = category.id === "software" ? copy.market.softwareTitle : copy.market.hardwareTitle;
          const body = category.id === "software" ? copy.market.softwareBody : copy.market.hardwareBody;
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
              <h2 className="mt-3 font-heading text-base font-semibold text-ink">{title}</h2>
              <p className="mt-1 font-body text-sm text-ink-muted">{body}</p>
              <p className="mt-3 font-body text-xs text-ink-faint">{copy.reservedCatalog}</p>
            </article>
          );
        })}
      </div>
      <p className="mt-6 max-w-2xl font-body text-xs text-ink-faint">{copy.market.footnote}</p>
    </ComingSoonScreen>
  );
}
