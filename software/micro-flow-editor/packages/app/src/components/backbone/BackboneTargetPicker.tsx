import { Info, LocateFixed } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useSession } from "../../state/session-context.js";
import { useLocale } from "../../state/locale-context.js";

export function BackboneTargetPicker({ disabled = false, onChange, bindingId }: { readonly bindingId?: string; readonly disabled?: boolean; readonly onChange?: (target: { bindingId: string; deviceIdHex: string }) => void }) {
  const { rows, getClient } = useCoreSessions();
  const { moduleTarget, setModuleTarget } = useSession();
  const { locale } = useLocale();
  const it = locale === "it";
  const choices = rows.filter(row => !bindingId || row.binding.bindingId === bindingId).flatMap(row => row.attachedBackbones.filter(board => board.productKind !== "nfc-reader").map((board, i) => ({ ...board, bindingId: row.binding.bindingId, ready: row.sessionState === "READY", label: `${rows.length > 1 ? `${row.displayName} · ` : ""}Backbone ${i + 1} · ${board.local ? row.hostLink === "wifi" ? "Wi-Fi" : "USB" : "CAN"} · ${board.mac || board.deviceIdHex.slice(0, 12)}` })));
  const selected = choices.find(choice => choice.bindingId === moduleTarget?.bindingId && choice.deviceIdHex === moduleTarget.deviceIdHex) ?? choices[0];
  const recentFirmware = (version: string | undefined) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
    return !!match && (Number(match[1]) > 0 || Number(match[2]) > 5 || (Number(match[2]) === 5 && Number(match[3]) >= 38));
  };
  const master = choices.find(choice => choice.bindingId === selected?.bindingId && choice.local);
  const supported = recentFirmware(selected?.version) && recentFirmware(master?.version);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function identify() {
    if (!selected) return;
    const client = getClient(selected.bindingId);
    if (!client) return;
    setError("");
    const key = `${selected.bindingId}:${selected.deviceIdHex}`;
    setBusyKey(key);
    try {
      await client.identifyBackbone(selected.local ? 0 : selected.nodeId);
      timer.current = setTimeout(() => setBusyKey(null), 10000);
    } catch (cause) {
      setBusyKey(null);
      setError(it ? "Riconoscimento non disponibile. Verifica la connessione e aggiorna il firmware delle Backbone alla versione 0.5.38 o successiva." : "Identification unavailable. Check the connection and update the Backbone firmware to 0.5.38 or later.");
    }
  }
  return <div className="flex min-w-0 flex-col gap-1">
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <select aria-label={it ? "Backbone di destinazione" : "Target Backbone"} disabled={disabled || !choices.length} value={selected ? `${selected.bindingId}:${selected.deviceIdHex}` : ""} onChange={event => {
        const choice = choices.find(item => `${item.bindingId}:${item.deviceIdHex}` === event.target.value);
        if (!choice) return;
        const target = { bindingId: choice.bindingId, deviceIdHex: choice.deviceIdHex };
        setModuleTarget(target); setError(""); onChange?.(target);
      }} className="min-w-0 max-w-full flex-1 rounded-slsm border border-border-strong bg-surface px-2 py-1.5 text-xs text-ink">
        {!choices.length && <option>{it ? "Nessuna Backbone connessa" : "No connected Backbone"}</option>}
        {choices.map(choice => <option key={`${choice.bindingId}:${choice.deviceIdHex}`} value={`${choice.bindingId}:${choice.deviceIdHex}`}>{choice.label}</option>)}
      </select>
      <button type="button" disabled={disabled || !selected?.ready || !supported || busyKey !== null} onClick={() => void identify()} className="inline-flex items-center gap-1 rounded-slsm border border-border-strong bg-surface px-2 py-1.5 text-xs text-ink disabled:opacity-40"><LocateFixed size={13} />{busyKey ? it ? "Lampeggio…" : "Blinking…" : it ? "Riconosci" : "Identify"}</button>
      <span className="group relative"><button type="button" aria-label={it ? "Informazioni su Riconosci" : "Identification information"} className="rounded-full p-1 text-ink-muted"><Info size={14} /></button><span role="tooltip" className="pointer-events-none absolute right-0 top-full z-50 hidden w-60 rounded-slmd border border-border bg-surface p-3 text-xs text-ink shadow-e2 group-hover:block group-focus-within:block">{it ? "La Backbone selezionata fa lampeggiare il LED interno per 10 secondi: 500 ms acceso e 500 ms spento. Poi il LED torna al controllo del programma." : "The selected Backbone blinks its internal LED for 10 seconds: 500 ms on, 500 ms off. The LED then returns to program control."}</span></span>
    </div>
    {selected && !supported && <p className="text-[10px] text-ink-muted">{it ? "Riconosci richiede firmware 0.5.38 sul master e sulla scheda selezionata." : "Identify requires firmware 0.5.38 on the master and selected board."}</p>}
    {error && <p role="alert" className="text-xs text-error">{error}</p>}
  </div>;
}
