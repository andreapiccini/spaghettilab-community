import type { ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
export function EditorSection({
  title,
  icon: Icon,
  children,
  collapsible = false,
  defaultOpen = false,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const heading = (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue">
        <Icon size={16} aria-hidden />
      </span>
      <span className="flex-1">{title}</span>
      {collapsible && (
        <ChevronDown
          size={14}
          className="-rotate-90 text-ink-muted transition-transform group-open/panel:rotate-0"
          aria-hidden
        />
      )}
    </>
  );
  const headerClass =
    "flex list-none items-center gap-2.5 bg-surface-sunken/60 px-3 py-3 font-body text-xs font-semibold text-ink [&::-webkit-details-marker]:hidden";
  const body = (
    <div className="mx-3 mb-3 ml-6 border-l-2 border-brand-blue/15 pl-3 pt-2">
      {children}
    </div>
  );
  return collapsible ? (
    <details
      open={defaultOpen}
      className="group/panel overflow-hidden rounded-slmd border border-border-strong bg-surface shadow-sm"
    >
      <summary className={`${headerClass} cursor-pointer`}>{heading}</summary>
      {body}
    </details>
  ) : (
    <section className="overflow-hidden rounded-slmd border border-border-strong bg-surface shadow-sm">
      <h2 className={headerClass}>{heading}</h2>
      {body}
    </section>
  );
}
