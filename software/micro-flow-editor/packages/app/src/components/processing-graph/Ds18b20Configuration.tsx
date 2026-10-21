import { useState, useRef } from "react";
import { DEFAULT_PHYSICAL_SETTINGS } from "@spaghettilab/protocol-sdk";
import { useSession } from "../../state/session-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useNfcPresence } from "../../state/nfc-presence-context.js";
import type { BackboneSensorModule } from "../../lib/backbone-sensor-modules.js";
import { configureDs18b20 } from "../../lib/ds18b20-configuration.js";
import { PHYSICAL_META_KEY, parsePhysicalProject, expectedFunctionTag, tagForSlot, topologyForBoard } from "../../lib/backbone-physical.js";
import { applyStoppedRuntime, waitConfigWriteGap } from "../../lib/stop-deployed-runtime.js";

export function Ds18b20Configuration({ module, bindingId }: { module: BackboneSensorModule; bindingId: string }) {
  const { session, execute } = useSession();
  const { getClient, observeConfig, setExecutionMode, lockTransport, unlockTransport } = useCoreSessions();
  const { pausePolling, resumePolling, waitUntilIdle } = useNfcPresence();
  const [mode, setMode] = useState<"parasite" | "vcc">((module.recipe.deviceDraft?.ds18b20PowerMode ?? "parasite") === "parasite" ? "parasite" : "vcc");
  const [data, setData] = useState(module.gpioAssignments?.channels.DATA ?? module.gpioAssignment?.channel ?? 0);
  const power = module.gpioAssignments?.channels.POWER ?? 1;
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  async function save() {
    if (!session || !execute || pending.current) return;
    pending.current = true; setBusy(true); setMessage("");
    let locked = false;
    try {
      const candidate = configureDs18b20(session.stack.current, bindingId, module.id, mode, data, power, false, "3.3");
      const boardKey = module.gpioAssignments?.boardKey ?? module.gpioAssignment!.boardKey;
      const board = parsePhysicalProject(candidate.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts[boardKey]!;
      const binding = session.stack.current.coreBindings.find(item => item.bindingId === bindingId);
      if (!binding) throw new Error("Backbone non disponibile.");
      const client = getClient(binding.bindingId);
      if (!client) throw new Error("Collega la Backbone per applicare la configurazione.");
      const signal = AbortSignal.timeout(30000);
      pausePolling(); lockTransport(); locked = true;
      await waitUntilIdle();
      const status = await client.getStatus(signal);
      const stopped = await applyStoppedRuntime(client, signal);
      observeConfig(binding.bindingId, stopped.config);
      setExecutionMode(binding.bindingId, "one-shot");
      if (stopped.changed) await waitConfigWriteGap(signal);
      await client.applyPhysical({ nodeId: 0, modes: new Uint8Array(board.modes), i2cSpeed: board.i2cSpeed,
        settings: (topologyForBoard(status, { local: true, nodeId: 0 })?.version ?? 0) >= 2 ? board.settings ?? DEFAULT_PHYSICAL_SETTINGS : undefined,
        expectedTag: expectedFunctionTag(tagForSlot(status, { local: true, nodeId: 0 }, 2), false) }, signal);
      const result = execute({ kind: "ConfigureDs18b20", apply: current => ({ ok: true, value: configureDs18b20(current, bindingId, module.id, mode, data, power, true, "3.3") }) });
      if (!result.ok) throw new Error("Configurazione non salvata.");
      setMessage("Configurazione applicata. Premi Attiva oppure Deploy & Run per caricare il programma.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (locked) { unlockTransport(); resumePolling(); } pending.current = false; setBusy(false); }
  }
  const field = "w-full rounded-lg border border-border-strong bg-surface px-2 py-2 text-sm";
  return <section className="space-y-3 rounded-xl border border-border p-3 text-sm">
    <h3 className="font-semibold">Configurazione DS18B20</h3>
    <label className="block space-y-1"><span>Alimentazione</span><select className={field} disabled={busy} value={mode} onChange={e => setMode(e.target.value as "parasite" | "vcc")}>
      <option value="parasite">Parassita</option><option value="vcc">VCC · 3,3 V</option>
    </select></label>
    <label className="block space-y-1"><span>Pin DATA</span><select className={field} disabled={busy} value={data} onChange={e => setData(Number(e.target.value))}>
      {[0,1,2,3].map(pin => <option key={pin} value={pin}>A{pin}</option>)}
    </select></label>
    <p className="text-xs text-ink-muted">{mode === "vcc"
      ? "Collega VCC alla linea 3,3 V e GND alla massa comune. Solo DATA usa un GPIO. Non usare 5 V: il pull-up della schedina porterebbe DATA a 5 V."
      : "VDD e GND a massa; DATA richiede il pull-up a 3,3 V e alimenta il sensore durante la conversione."}</p>
    <button type="button" disabled={busy || !execute} onClick={() => void save()} className="rounded-lg bg-brand-blue px-3 py-2 text-white disabled:opacity-40">{busy ? "Applicazione…" : "Applica configurazione"}</button>
    {message && <p role="status" className="text-xs text-ink-muted">{message}</p>}
  </section>;
}
