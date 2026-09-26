import { GraduationCap } from "lucide-react";
import { comingSoonCopy } from "../../lib/coming-soon-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { ComingSoonScreen } from "./ComingSoonScreen.js";

export function EducationScreen() {
  const { locale } = useLocale();
  const copy = comingSoonCopy(locale);

  return (
    <ComingSoonScreen icon={GraduationCap} title={copy.education.title} description={copy.education.description}>
      <div className="mt-6 max-w-xl rounded-slmd border border-border bg-surface p-4 shadow-e1">
        <h2 className="font-heading text-base font-semibold text-ink">{copy.education.heading}</h2>
        <ul className="mt-2 list-disc pl-5 font-body text-sm text-ink-muted">
          {copy.education.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 font-body text-xs text-ink-faint">{copy.education.empty}</p>
      </div>
    </ComingSoonScreen>
  );
}
