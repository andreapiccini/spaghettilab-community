import type { DeviceRecipeDraft } from "../../lib/device-recipe-draft.js";
import { dht22OutputFormat, setDht22OutputFormat } from "../../lib/dht22-driver.js";

export function Dht22FlowPanel({ draft, onChange }: { draft: DeviceRecipeDraft; onChange: (draft: DeviceRecipeDraft) => void }) {
  const format = dht22OutputFormat(draft);
  const convert = draft.commands.flatMap(action => action.steps).find(step => step.type === "dht22_convert");
  return <div className="mx-auto my-4 w-full max-w-3xl space-y-5">
    <section className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-base font-semibold text-ink">Ingresso · Leggi temperatura</h3>
      <p className="mt-3 text-sm text-ink">Segnale digitale o booleano <span className="text-brand-blue">→</span> azione Leggi temperatura</p>
      <p className="mt-2 text-sm text-ink-muted">Trigger sul fronte di salita: basso → alto oppure false → true. Mantenere il segnale alto non ripete la lettura.</p>
    </section>
    <section className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-base font-semibold text-ink">Uscita · Temperatura</h3>
      <p className="mt-3 text-sm text-ink">Variabile <span className="font-mono text-brand-blue">${convert?.type === "dht22_convert" ? convert.into : "temperatura"}</span> <span className="text-brand-blue">→</span> ultimo valore acquisito e convertito in °C</p>
      <label className="mt-4 block text-sm text-ink-muted">Formato del valore
        <select aria-label="Formato temperatura" className="mt-2 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-ink" value={format} onChange={event => onChange(setDht22OutputFormat(draft, event.target.value as "float" | "string"))}>
          <option value="float">Numero decimale (float) · 23.4</option>
          <option value="string">Testo con unità · 23.4 °C</option>
        </select>
      </label>
      <p className="mt-2 text-sm text-ink-muted">L’uscita si aggiorna soltanto dopo una lettura valida. Prima della prima misura non viene pubblicato un valore fittizio.</p>
    </section>
  </div>;
}
