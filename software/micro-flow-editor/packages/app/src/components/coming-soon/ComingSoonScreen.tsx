import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { comingSoonCopy } from "../../lib/coming-soon-copy.js";
import { useLocale } from "../../state/locale-context.js";

/**
 * Intentional reserved section — title, purpose, and a "Coming soon" badge.
 * Never fake catalog/checkout/lesson data; children are structure-only hints.
 */
export function ComingSoonScreen({
  icon: Icon,
  title,
  description,
  children,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly children?: ReactNode;
}) {
  const { locale } = useLocale();
  const copy = comingSoonCopy(locale);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <Icon size={20} className="shrink-0 text-brand-blue" />
        <h1 className="font-heading text-lg font-semibold text-ink">{title}</h1>
        <span
          className="rounded-slpill px-2.5 py-0.5 font-body text-xs"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-brand-purple-glow) 12%, transparent)",
            color: "var(--color-brand-purple-glow)",
          }}
        >
          {copy.badge}
        </span>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <p className="max-w-2xl font-body text-sm text-ink-muted">{description}</p>
        {children}
      </div>
    </div>
  );
}
