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
  const { rows, getClient, getSnapshot } = useCoreSessions();
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
  const ready = row?.sessionState === "READY";
  async function send() {
    const client = binding && getClient(binding.bindingId);
    if (!client || sending.current || !ready) return;
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
      if (!module) throw new Error("Esegui Run Deploy per caricare questo generatore.");
      await sendManualTrigger((commandId) =>
        client.moduleCommand({ key: module.key, commandId }, signal),
      );
      setMessage("Trigger inviato");
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
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="pointer-events-none flex items-center gap-2 text-xs font-semibold text-brand-blue">
        <MousePointerClick size={16} />
        <span>Genera trigger</span>
      </div>
      <button
        type="button"
        className="nodrag nopan rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        disabled={!ready || !deployed || busy}
        onClick={(event) => {
          event.stopPropagation();
          void send();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {busy ? "Invio…" : "Invia trigger"}
      </button>
      <p
        role="status"
        className="pointer-events-none mt-auto line-clamp-2 text-[10px] text-ink-muted"
      >
        {!ready
          ? "Collega la Backbone"
          : !deployed
            ? "Esegui Run Deploy per attivare il pulsante"
            : message || "Manuale · PC collegato"}
      </p>
    </div>
  );
}
