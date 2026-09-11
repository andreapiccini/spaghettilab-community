import { GraduationCap } from "lucide-react";
import { ComingSoonScreen } from "./ComingSoonScreen.js";

export function EducationScreen() {
  return (
    <ComingSoonScreen
      icon={GraduationCap}
      title="Formazione"
      description="Spiegazioni e lezioni su Core, moduli e flow. I contenuti didattici arriveranno qui, distinti da datasheet e istruzioni tecniche."
    >
      <div className="mt-6 max-w-xl rounded-slmd border border-border bg-surface p-4 shadow-e1">
        <h2 className="font-heading text-base font-semibold text-ink">Cosa troverai</h2>
        <ul className="mt-2 list-disc pl-5 font-body text-sm text-ink-muted">
          <li>Percorsi guidati per i primi progetti</li>
          <li>Lezioni sui moduli software e hardware</li>
          <li>Esempi collegati al canvas del progetto aperto</li>
        </ul>
        <p className="mt-3 font-body text-xs text-ink-faint">
          Nessuna lezione pubblicata — Coming soon
        </p>
      </div>
    </ComingSoonScreen>
  );
}
