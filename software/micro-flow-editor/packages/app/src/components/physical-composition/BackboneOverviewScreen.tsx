import { topologyNeedsReconfiguration } from "../../lib/backbone-topology-change.js";
import { CircuitBoard, Cpu } from "lucide-react";
import { useState } from "react";
import { useSession } from "../../state/session-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { logicalBackboneKey } from "../../lib/logical-backbone-slots.js";
import {
  DEFAULT_FUNCTION_VARIANT,
  PHYSICAL_META_KEY,
  defaultModesForVariant,
  functionVariantOf,
  parsePhysicalProject,
  topologyForBoard,
  type BackbonePhysicalDraft,
} from "../../lib/backbone-physical.js";
import { PhysicalBoardOverview } from "./PhysicalBoardOverview.js";

/** Cached project/firmware view only: no polling, configuration writes or editors. */
export function BackboneOverviewScreen() {
  const { session, physicalTarget } = useSession();
  const { rows, getSnapshot } = useCoreSessions();
  const { locale } = useLocale();
  const it = locale === "it";
  const bindings = session?.stack.current.coreBindings ?? [];
  const [selectedKey, setSelectedKey] = useState(
    physicalTarget ? `${physicalTarget.bindingId}:${physicalTarget.deviceIdHex}` : "",
  );
  const physical = parsePhysicalProject(
    session?.stack.current.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  );
  const choices = bindings.flatMap((binding) => {
    const row = rows.find((item) => item.binding.bindingId === binding.bindingId);
    const status = getSnapshot(binding.bindingId)?.status;
    const connected =
      row?.attachedBackbones.filter((board) => board.productKind !== "nfc-reader") ??
      [];
    const boards = connected.length
      ? connected
      : [
          {
            deviceIdHex: binding.expectedDeviceId,
            nodeId: 0,
            local: true,
            productKind: "backbone",
          },
        ];
    return boards.map((board, index) => {
      const key = `${binding.bindingId}:${board.deviceIdHex}`;
      const boardKey =
        logicalBackboneKey(
          session?.stack.current,
          binding.bindingId,
          status,
          board.nodeId,
        ) ?? key;
      const pending = !!session && topologyNeedsReconfiguration(session.stack.current, binding.bindingId, status);
      const saved = pending ? undefined : physical.drafts[boardKey];
      const live = status ? topologyForBoard(status, board) : undefined;
      const variant = live
        ? live.layout === 2
          ? ("v2" as const)
          : ("v1" as const)
        : saved
          ? functionVariantOf(saved)
          : DEFAULT_FUNCTION_VARIANT;
      const draft: BackbonePhysicalDraft = saved ?? {
        name: `Backbone ${index + 1}`,
        variant,
        modes: live?.modes ?? defaultModesForVariant(variant),
        i2cSpeed: live?.i2cSpeed ?? 0,
        local: board.local,
        nodeId: board.nodeId,
      };
      return {
        key,
        boardKey,
        bindingId: binding.bindingId,
        label: `${bindings.length > 1 ? `${row?.displayName ?? "Cluster"} · ` : ""}Backbone ${index + 1}`,
        link: board.local ? (row?.hostLink === "wifi" ? "Wi-Fi" : "USB") : "CAN",
        pending,
        ready: row?.sessionState === "READY" && connected.length > 0,
        draft: { ...draft, variant },
      };
    });
  });
  const selected = choices.find((item) => item.key === selectedKey) ?? choices[0];
  return (
    <div className="mx-auto max-w-6xl p-5 sm:p-7">
      <header className="mb-5">
        <h1 className="flex items-center gap-3 text-2xl font-semibold">
          <CircuitBoard className="text-brand-blue" />
          {it ? "Schede e collegamenti" : "Boards and connections"}
        </h1>
      </header>
      {!selected ? (
        <p className="text-sm text-ink-muted">
          {it ? "Nessuna Backbone nel progetto." : "No Backbone in this project."}
        </p>
      ) : (
        <>
          {choices.length > 1 && (
            <nav
              aria-label={it ? "Backbone" : "Backbones"}
              className="mb-5 flex flex-wrap gap-2"
            >
              {choices.map((choice) => (
                <button
                  type="button"
                  key={choice.key}
                  aria-pressed={choice.key === selected.key}
                  onClick={() => setSelectedKey(choice.key)}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm ${choice.key === selected.key ? "border-brand-blue bg-brand-blue/10 text-brand-blue" : "border-border bg-surface text-ink-muted"}`}
                >
                  <Cpu size={16} />
                  {choice.label}
                  <span className="text-xs">{choice.link}</span>
                </button>
              ))}
            </nav>
          )}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">{selected.label}</h2>
            <span className="text-sm text-ink-muted">
              {selected.link} · {selected.draft.variant?.toUpperCase()}
            </span>
            <span
              className={`rounded-full px-2 py-1 text-xs ${selected.ready ? "bg-success/10 text-success" : "bg-surface-raised text-ink-muted"}`}
            >
              {selected.ready
                ? it
                  ? "Connessa"
                  : "Connected"
                : it
                  ? "Non connessa"
                  : "Offline"}
            </span>
            {selected.draft.applied === false && (
              <span className="text-xs text-ink-muted">
                {it
                  ? "Configurazione del progetto · da caricare"
                  : "Project configuration · pending upload"}
              </span>
            )}
          </div>
          {selected.pending ? <p className="rounded-xl border border-warning/30 bg-warning/10 p-5">Variazione delle Backbone rilevata. I collegamenti dei moduli non sono confermati: riconfigura le schede dall’avviso in alto.</p> : <PhysicalBoardOverview
            key={selected.key}
            draft={selected.draft}
            bindingId={selected.bindingId}
            boardKey={selected.boardKey}
            it={it}
            capabilities={0}
            disabled
            readOnly
            onChange={() => {}}
            onPendingChange={() => {}}
          />}
        </>
      )}
    </div>
  );
}
