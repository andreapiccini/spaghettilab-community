import { topologyForBoard, expectedFunctionTag, tagForSlot } from "../lib/backbone-physical.js";
import { useEffect, useRef } from "react";
import { exportProjectV1, importProjectV1 } from "@spaghettilab/domain";
import { useSession } from "../state/session-context.js";
import { useCoreSessions } from "../state/core-sessions-context.js";
import { useNfcPresence } from "../state/nfc-presence-context.js";
import { projectRepository } from "../lib/repository.js";
import { applyStoppedRuntime, pauseContinuousRuntime } from "../lib/stop-deployed-runtime.js";
import { pauseDistributedParticipants } from "../lib/distributed-deployment.js";

import { FAIR_BASELINE, FAIR_PREVIOUS, createFairStartupProject, clearFairProject, captureFairBaseline, restoreFairBaseline } from "../lib/fair-kiosk-baseline.js";

/** Operator-only integration; never reads the questionnaire or submits answers. */
export function FairKioskBridge() {
  const { session, openProject, markSaved, closeDeploy } = useSession();
  const cores = useCoreSessions();
  const presence = useNfcPresence();
  const busy = useRef(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || !new URLSearchParams(location.search).has("fair")) return;
    initialized.current = true;
    const raw = localStorage.getItem(FAIR_BASELINE);
    const parsed = raw ? importProjectV1(raw) : null;
    if (session) localStorage.setItem(FAIR_PREVIOUS, exportProjectV1(session.stack.current));
    const project = createFairStartupProject(parsed?.ok ? parsed.value : session?.stack.current ?? null);
    openProject(project.projectId, project, { screen: "processing-graph" });
  }, [session, openProject]);

  useEffect(() => {
    async function stop() {
      if (!session) throw new Error("Apri il progetto della demo prima di inviare lo Stop.");
      const signal = AbortSignal.timeout(85000);
      const roots = cores.rows.filter(row => !row.viaCan);
      if (!roots.length && session.stack.current.coreBindings.length)
        throw new Error("Collega la Backbone prima del ripristino: lo Stop deve essere confermato.");
      presence.pausePolling();
      cores.lockTransport();
      try {
        await Promise.race([
          presence.waitUntilIdle(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Operazione hardware già in corso.")), 10000)),
        ]);
        for (const row of roots) {
          const id = row.binding.bindingId;
          const client = cores.getClient(id);
          if (!client) throw new Error("Backbone non connessa: Stop non confermato.");
          if (cores.getExecutionMode(id) === "busy") throw new Error("Backbone occupata: attendi il completamento dell’operazione.");
          cores.setExecutionMode(id, "busy");
          try {
            const stopped = await pauseContinuousRuntime(client, signal);
            await pauseDistributedParticipants(client, String(session.stack.current.projectId), signal, () => {}, stopped);
            cores.observeConfig(id, stopped);
            cores.setExecutionMode(id, "one-shot");
          } catch (error) {
            cores.setExecutionMode(id, "continuous");
            throw error;
          }
        }
      } finally {
        cores.unlockTransport();
        presence.resumePolling();
      }
    }
    async function command(action: string) {
      if (action === "capture") {
        const intentResponse = await fetch("http://127.0.0.1:8767/app-intent", { signal: AbortSignal.timeout(4000) });
        if (!intentResponse.ok) throw new Error("Controllo fiera non pronto: nessuna modifica eseguita.");
        const intent = await intentResponse.json() as { intent?: string };
        if (intent.intent === "clear-project") {
          if (!session) throw new Error("Apri prima il canvas da svuotare.");
          const current = session.stack.current;
          await clearFairProject({ storage: localStorage, current,
            resetHardware: async () => {
              const signal = AbortSignal.timeout(100000);
              const roots = cores.rows.filter(row => !row.viaCan);
              if (!roots.length && current.coreBindings.length) throw new Error("Collega la Backbone prima di resettare i moduli.");
              presence.pausePolling(); cores.lockTransport();
              try {
                await Promise.race([presence.waitUntilIdle(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Comunicazione occupata: riprova il reset.")), 10000))]);
                for (const row of roots) {
                  const client = cores.getClient(row.binding.bindingId);
                  if (!client || cores.getExecutionMode(row.binding.bindingId) === "busy") throw new Error("Backbone non disponibile: reset non eseguito.");
                  const status = await client.getStatus(signal);
                  const boards = [{ local: true, nodeId: 0 }, ...(status.chainPeers ?? []).filter(peer => !peer.local).map(peer => ({ local: false, nodeId: peer.nodeId }))];
                  // Save the actual board programs before removing runtime modules.
                  for (const board of boards) {
                    const target = board.local ? client : client.forCanNode(board.nodeId);
                    try {
                      const original = await target.getConfig(signal);
                      localStorage.setItem(`spaghettilab.fair.hardware-before-clear:${current.projectId}:${board.nodeId}`,
                        JSON.stringify({ config: Array.from(original.configBytes), physical: topologyForBoard(status, board) }));
                    } finally { if (!board.local) target.dispose(); }
                  }
                  for (const board of boards) {
                    const target = board.local ? client : client.forCanNode(board.nodeId);
                    try { await applyStoppedRuntime(target, signal); }
                    finally { if (!board.local) target.dispose(); }
                  }
                  for (const board of boards) {
                    const physical = topologyForBoard(status, board);
                    if (physical?.modes.some(mode => mode !== 0)) {
                      await client.applyPhysical({ nodeId: board.nodeId, modes: new Uint8Array(physical.modes.length),
                        i2cSpeed: physical.i2cSpeed, settings: physical.settings,
                        expectedTag: expectedFunctionTag(tagForSlot(status, board, 2), false) }, signal);
                    }
                  }
                  cores.observeConfig(row.binding.bindingId, await client.getConfig(signal));
                  cores.setExecutionMode(row.binding.bindingId, "one-shot");
                }
              } finally { cores.unlockTransport(); presence.resumePolling(); }
            },
            save: project => projectRepository.save(project),
            open: project => { closeDeploy(); openProject(project.projectId, project, { screen: "processing-graph" }); },
          });
          return { ok: true, operation: "clear-project", project: current.name };
        }
        if (!session) throw new Error("Apri il progetto da usare come base demo, poi ripeti Salva base.");
        const project = session.stack.current;
        await captureFairBaseline(project, localStorage, project => projectRepository.save(project));
        markSaved();
        return { ok: true, project: project.name };
      }
      if (action === "stop") {
        await stop();
        return { ok: true };
      }
      if (action !== "restore") throw new Error("Comando demo sconosciuto.");
      const project = await restoreFairBaseline({
        storage: localStorage,
        current: session?.stack.current ?? null,
        stop,
        save: project => projectRepository.save(project),
        open: project => {
          closeDeploy();
          openProject(project.projectId, project, { screen: "processing-graph" });
        },
      });
      return { ok: true, project: project.name };
    }
    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin ||
          event.data?.channel !== "spaghettilab-fair" || typeof event.data.id !== "string") return;
      const { id, action } = event.data as { id: string; action: string };
      const reply = (result: object) => window.postMessage({ channel: "spaghettilab-fair-result", id, result }, location.origin);
      if (busy.current) { reply({ ok: false, error: "Un comando demo è già in corso." }); return; }
      busy.current = true;
      void command(action).then(reply).catch((error: unknown) => reply({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        .finally(() => { busy.current = false; });
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [session, openProject, markSaved, closeDeploy, cores, presence]);
  return null;
}
