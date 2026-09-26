import { Network, Plus } from "lucide-react";
import { useState } from "react";
import { coreConnectionsCopy } from "../../lib/core-connections-copy.js";
import { reconnectCoreBinding } from "../../lib/reconnect-binding.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { ConnectCoreDialog } from "./ConnectCoreDialog.js";
import { CoreRow } from "./CoreRow.js";

/** `ux/screens/S030-core-connections/visual.md` + `ui-behavior.md`. */
export function CoreConnectionsScreen() {
  const { session } = useSession();
  const { rows, connect, fail } = useCoreSessions();
  const { locale } = useLocale();
  const copy = coreConnectionsCopy(locale);
  const [dialogOpen, setDialogOpen] = useState(false);

  const total = session?.stack.current.coreBindings.length ?? 0;
  const outOfSync = rows.filter((r) => r.sessionState === "READY" && r.syncRelationship && r.syncRelationship !== "IN_SYNC").length;
  const subtitle = total === 0 ? copy.noCoreShort : outOfSync > 0 ? copy.coresOutOfSync(total, outOfSync) : copy.coresCount(total);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center border-b border-border bg-surface px-4">
        <div>
          <h1 className="font-heading text-[28px] font-bold leading-none text-ink">Core Connections</h1>
          <p className="font-body text-xs text-ink-muted">{subtitle}</p>
        </div>
        <button type="button" onClick={() => setDialogOpen(true)} className="ml-auto flex items-center gap-1.5 rounded-slpill bg-brand-blue px-4 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark">
          <Plus size={16} />
          {copy.connectACore}
        </button>
      </div>

      {total === 0 ? (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-3 overflow-hidden">
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--color-brand-cyan-glow) 10%, transparent), transparent 60%), radial-gradient(circle at 70% 70%, color-mix(in srgb, var(--color-brand-purple-glow) 10%, transparent), transparent 60%)" }} />
          <Network size={48} className="relative text-ink-faint" />
          <h2 className="relative font-heading text-lg font-semibold text-ink">{copy.emptyTitle}</h2>
          <p className="relative font-body text-sm text-ink-muted">{copy.emptyBody}</p>
          <button type="button" onClick={() => setDialogOpen(true)} className="relative mt-2 rounded-slpill bg-brand-blue px-4 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark">
            {copy.connectFirst}
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <div className="flex flex-col gap-3">
            {rows.map((row, bindingIndex) => (
              <CoreRow
                key={row.binding.bindingId}
                row={row}
                bindingIndex={bindingIndex}
                onConnect={() =>
                  void reconnectCoreBinding(row.binding, connect).catch((cause: unknown) => {
                    fail(row.binding.bindingId, cause instanceof Error ? cause.message : String(cause));
                  })
                }
              />
            ))}
          </div>
        </div>
      )}

      <ConnectCoreDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onConnect={(binding, link) => void connect(binding, link)} />
    </div>
  );
}
