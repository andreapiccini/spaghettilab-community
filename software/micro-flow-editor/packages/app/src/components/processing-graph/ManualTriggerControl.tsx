import { useRef, useState } from "react";
import { MousePointerClick } from "lucide-react";
import { decodeConfigCbor } from "@spaghettilab/config-decompiler";
import { manualTriggerProfileId, sendManualTrigger } from "../../lib/flow-trigger.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
export function ManualTriggerControl({
  nodeId,
  bindingId,
}: {
  nodeId: string;
  bindingId?: string;
}) {
  const { rows, getClient, getSnapshot, getExecutionMode } = useCoreSessions();
  const row = rows.find((item) => item.binding.bindingId === bindingId);
  const binding = row?.binding;
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [message, setMessage] = useState("");
  const profileId = manualTriggerProfileId(nodeId);
  const config = binding ? getSnapshot(binding.bindingId)?.config : undefined;
  const decoded = config && decodeConfigCbor(config.configBytes);
  const deployed =
    decoded?.ok &&
    decoded.value.modules.some(
      (module) =>
        module.typeId === "declarative-device" && module.properties[1] === profileId,
    );
  const continuous = binding
    ? getExecutionMode(binding.bindingId) !== "one-shot"
    : false;
  const ready = row?.sessionState === "READY";
  async function send() {
    const client = binding && getClient(binding.bindingId);
    if (!client || sending.current || !ready || continuous) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const signal = AbortSignal.timeout(10000);
      const live = decodeConfigCbor((await client.getConfig(signal)).configBytes);
      const module =
        live.ok &&
        live.value.modules.find(
          (item) =>
            item.typeId === "declarative-device" && item.properties[1] === profileId,
        );
      if (!module) throw new Error("Esegui Run Deploy per caricare questo blocco.");
      await sendManualTrigger((commandId) =>
        client.moduleCommand({ key: module.key, commandId }, signal),
      );
      setMessage("Azione attivata");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      // Bound manual traffic, including the LOW/HIGH/LOW records sent to the host.
      await new Promise((resolve) => setTimeout(resolve, 500));
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <div
      className={`flex h-full flex-col gap-2 rounded-lg p-3 ${continuous ? "bg-surface-raised opacity-60 grayscale" : ""}`}
    >
      <div className="pointer-events-none flex items-center gap-2 pr-5 text-xs font-semibold text-brand-blue">
        <MousePointerClick size={16} />
        <span>Attiva azione</span>
      </div>
      <button
        type="button"
        className="nopan rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white disabled:pointer-events-none disabled:opacity-40"
        disabled={continuous || !ready || !deployed || busy}
        title={continuous ? "Premi Stop per usare le prove manuali" : !ready ? "Collega la Backbone" : !deployed ? "Carica il programma per le prove manuali" : message || "Esegue una volta le azioni collegate"}
        onClick={(event) => {
          event.stopPropagation();
          void send();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {busy ? "Attivazione…" : "Attiva"}
      </button>
      <span role="status" className="sr-only">{message}</span>
    </div>
  );
}
