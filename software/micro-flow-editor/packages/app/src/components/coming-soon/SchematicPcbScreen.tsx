import { CircuitBoard } from "lucide-react";
import { useSession } from "../../state/session-context.js";
import { ComingSoonScreen } from "./ComingSoonScreen.js";

/**
 * Future schematic + PCB export from the hardware already composed and
 * discovered in Physical Composition. Placeholder only — that canvas stays untouched.
 */
export function SchematicPcbScreen() {
  const { navigate } = useSession();

  return (
    <ComingSoonScreen
      icon={CircuitBoard}
      title="Genera schematico e PCB"
      description="Da qui si genereranno schematico e PCB a partire dai moduli hardware già collegati e riconosciuti in Physical Composition. Lo strumento non è ancora disponibile."
    >
      <div className="mt-6 max-w-xl rounded-slmd border border-border bg-surface p-4 shadow-e1">
        <h2 className="font-heading text-base font-semibold text-ink">
          Sorgente prevista
        </h2>
        <p className="mt-1 font-body text-sm text-ink-muted">
          Composizione fisica, porte configurate e hardware scoperto sul Core — la
          stessa sezione che già mostra i moduli rilevati.
        </p>
        <button
          type="button"
          onClick={() => navigate("physical-composition")}
          className="mt-4 rounded-slpill bg-brand-blue px-4 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark"
        >
          Vai a Physical Composition
        </button>
      </div>
    </ComingSoonScreen>
  );
}
