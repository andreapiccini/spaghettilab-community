import { BookOpen } from "lucide-react";
import { ComingSoonScreen } from "./ComingSoonScreen.js";

export function DatasheetsScreen() {
  return (
    <ComingSoonScreen
      icon={BookOpen}
      title="Datasheet e istruzioni"
      description="Consultazione di datasheet, pinout e istruzioni d'uso per ogni modulo software e hardware del catalogo. L'archivio non è ancora collegato."
    >
      <div className="mt-6 max-w-xl rounded-slmd border border-border bg-surface p-4 shadow-e1">
        <h2 className="font-heading text-base font-semibold text-ink">Cosa troverai</h2>
        <ul className="mt-2 list-disc pl-5 font-body text-sm text-ink-muted">
          <li>Datasheet e specifiche dei moduli</li>
          <li>Istruzioni di cablaggio e primo avvio</li>
          <li>Riferimenti collegati all&apos;hardware già riconosciuto</li>
        </ul>
        <p className="mt-3 font-body text-xs text-ink-faint">
          Archivio riservato — Coming soon
        </p>
      </div>
    </ComingSoonScreen>
  );
}
