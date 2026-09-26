import { BookOpen } from "lucide-react";
import { comingSoonCopy } from "../../lib/coming-soon-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { ComingSoonScreen } from "./ComingSoonScreen.js";

export function DatasheetsScreen() {
  const { locale } = useLocale();
  const copy = comingSoonCopy(locale);

  return (
    <ComingSoonScreen icon={BookOpen} title={copy.datasheets.title} description={copy.datasheets.description}>
      <div className="mt-6 max-w-xl rounded-slmd border border-border bg-surface p-4 shadow-e1">
        <h2 className="font-heading text-base font-semibold text-ink">{copy.datasheets.heading}</h2>
        <ul className="mt-2 list-disc pl-5 font-body text-sm text-ink-muted">
          {copy.datasheets.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 font-body text-xs text-ink-faint">{copy.datasheets.empty}</p>
      </div>
    </ComingSoonScreen>
  );
}
