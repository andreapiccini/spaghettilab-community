import { Network, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { coreConnectionsCopy } from "../../lib/core-connections-copy.js";
import { formatDeviceId } from "../../lib/core-identity.js";
import { reconnectCoreBinding } from "../../lib/reconnect-binding.js";
import { useLocale } from "../../state/locale-context.js";
import { attachedFromStatus, liveAttachedChain, type AttachedBackbone } from "../../state/core-sessions-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { ConnectCoreDialog } from "./ConnectCoreDialog.js";
import { CoreRow } from "./CoreRow.js";

/** `ux/screens/S030-core-connections/visual.md` + `ui-behavior.md`. */
export function isVisibleBackboneRoot(
  row: Pick<ReturnType<typeof useCoreSessions>["rows"][number], "viaCan" | "hostLink" | "sessionState">,
): boolean {
  return (
    row.viaCan === null &&
    !(row.hostLink === "usb" && (row.sessionState === "DISCONNECTED" || row.sessionState === "ERROR"))
  );
}

export function CoreConnectionsScreen() {
  const { rows, connect, fail, getSnapshot, setAttachedBackbones } = useCoreSessions();
  const { locale } = useLocale();
  const copy = coreConnectionsCopy(locale);
  const [dialogOpen, setDialogOpen] = useState(false);

  const roots = rows.filter(isVisibleBackboneRoot);
  const chainKeys = roots
    .map((root) => {
      const status = getSnapshot(root.binding.bindingId)?.status;
      const peers = status?.chainPeers ?? [];
      return `${root.binding.bindingId}:${peers.map((peer) => `${peer.nodeId}:${peer.local ? 1 : 0}:${peer.version ?? ""}`).join(",")}`;
    })
    .join("|");
  const attachedByRoot = useMemo(() => {
    const map = new Map<string, AttachedBackbone[]>();
    for (const root of roots) {
      const liveSelf = root.attachedBackbones.find((peer) => peer.local);
      const fallback: AttachedBackbone = {
        deviceIdHex: root.binding.expectedDeviceId,
        mac: formatDeviceId(root.binding.expectedDeviceId),
        nodeId: 0,
        local: true,
        version: liveSelf?.version,
      };
      const fromStatus = attachedFromStatus(getSnapshot(root.binding.bindingId)?.status, root.binding.expectedDeviceId);
      map.set(root.binding.bindingId, fromStatus ?? liveAttachedChain(root.attachedBackbones, fallback));
    }
    return map;
    // chainKeys tracks live GET_STATUS peer identity so unplug drops a Backbone without waiting on attachedRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roots + chainKeys are the intentional inputs
  }, [roots, chainKeys, getSnapshot]);

  useEffect(() => {
    for (const root of roots) {
      const peers = attachedFromStatus(getSnapshot(root.binding.bindingId)?.status, root.binding.expectedDeviceId);
      if (!peers) continue;
      const current = root.attachedBackbones;
      const same =
        peers.length === current.length &&
        peers.every((peer, index) => peer.deviceIdHex === current[index]?.deviceIdHex && peer.version === current[index]?.version && peer.local === current[index]?.local);
      if (same) continue;
      setAttachedBackbones(root.binding.bindingId, peers);
    }
  }, [roots, chainKeys, getSnapshot, setAttachedBackbones]);

  const backboneTotal = roots.reduce((total, root) => {
    const chain = attachedByRoot.get(root.binding.bindingId) ?? [];
    return total + Math.max(chain.length, 1);
  }, 0);
  const clusterCount = roots.length;
  const subtitle =
    roots.length === 0
      ? copy.noCoreShort
      : `${clusterCount === 1 ? "1 cluster" : `${clusterCount} clusters`} · ${copy.coresCount(backboneTotal)}`;


  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center border-b border-border bg-surface px-4">
        <div>
          <h1 className="font-heading text-[28px] font-bold leading-none text-ink">{copy.screenTitle}</h1>
          <p className="font-body text-xs text-ink-muted">{subtitle}</p>
        </div>
        <button type="button" onClick={() => setDialogOpen(true)} className="ml-auto flex items-center gap-1.5 rounded-slpill bg-brand-blue px-4 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark">
          <Plus size={16} />
          {copy.connectACore}
        </button>
      </div>

      {roots.length === 0 ? (
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
            {roots.map((row, index) => (
              <CoreRow
                key={row.binding.bindingId}
                row={row}
                clusterIndex={index + 1}
                attached={attachedByRoot.get(row.binding.bindingId) ?? []}
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
