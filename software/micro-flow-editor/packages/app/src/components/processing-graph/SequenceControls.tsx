import { useState } from "react";
import { Play, Pause, Square } from "lucide-react";
import { decodeConfigCbor } from "@spaghettilab/config-decompiler";
import { stableDriverHash } from "../../lib/driver-runtime-profile.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";

/** Commands only the deployed sequence with the same persistent canvas identity. */
export function SequenceControls({
  nodeId,
  bindingId,
}: {
  nodeId: string;
  bindingId?: string;
}) {
  const { rows, getClient } = useCoreSessions();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const connected = rows.some(
    (row) => row.binding.bindingId === bindingId && row.sessionState === "READY",
  );
  async function send(commandId: number) {
    const binding = rows.find((row) => row.binding.bindingId === bindingId)?.binding;
    const client = binding ? getClient(binding.bindingId) : undefined;
    if (!client || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const signal = AbortSignal.timeout(10000);
      const current = await client.getConfig(signal);
      const decoded = decodeConfigCbor(current.configBytes);
      if (!decoded.ok) throw new Error("Configurazione della Backbone non leggibile.");
      const module = decoded.value.modules.find(
        (item) =>
          item.typeId === "sequence" && item.properties[7] === stableDriverHash(nodeId),
      );
      if (!module)
        throw new Error("Esegui prima Run Deploy per caricare questa sequenza.");
      await client.moduleCommand({ key: module.key, commandId }, signal);
      setMessage(
        commandId === 1
          ? "Avvio / ripresa richiesti alla Backbone."
          : commandId === 2
            ? "Pausa richiesta alla Backbone."
            : "Stop richiesto alla Backbone.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mb-4 rounded-xl border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold">Controlla sulla Backbone</h3>
      <p className="mb-3 text-xs text-ink-muted">
        Comanda la versione già caricata con Run Deploy.
      </p>
      <div className="flex gap-2">
        {[
          { id: 1, text: "Avvia", Icon: Play },
          { id: 2, text: "Pausa", Icon: Pause },
          { id: 3, text: "Stop", Icon: Square },
        ].map(({ id, text, Icon }) => (
          <button
            key={id}
            type="button"
            disabled={!connected || busy}
            onClick={() => void send(id)}
            className="flex items-center gap-1 rounded-lg border border-border-strong px-2 py-2 text-xs text-brand-blue disabled:opacity-40"
          >
            <Icon size={14} />
            {text}
          </button>
        ))}
      </div>
      {!connected && (
        <p className="mt-2 text-xs text-ink-muted">
          Collega la Backbone per usare i comandi.
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 text-xs text-ink-muted">
          {message}
        </p>
      )}
    </section>
  );
}
