import { Network, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { coreConnectionsCopy } from "../../lib/core-connections-copy.js";
import { formatDeviceId } from "../../lib/core-identity.js";
import { probeUsbBridgeCores } from "../../lib/probe-usb-cores.js";
import { reconnectCoreBinding } from "../../lib/reconnect-binding.js";
import { useLocale } from "../../state/locale-context.js";
import type { AttachedBackbone } from "../../state/core-sessions-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { ConnectCoreDialog } from "./ConnectCoreDialog.js";
import { CoreRow } from "./CoreRow.js";

/** `ux/screens/S030-core-connections/visual.md` + `ui-behavior.md`. */
export function CoreConnectionsScreen() {
  const { rows, connect, fail, setAttachedBackbones } = useCoreSessions();
  const { locale } = useLocale();
  const copy = coreConnectionsCopy(locale);
  const [dialogOpen, setDialogOpen] = useState(false);

  const roots = rows.filter((row) => row.viaCan === null);
  const attachedByRoot = useMemo(() => {
    const map = new Map<string, AttachedBackbone[]>();
    for (const root of roots) {
      const liveSelf = root.attachedBackbones.find((peer) => peer.local);
      const self: AttachedBackbone = {
        deviceIdHex: root.binding.expectedDeviceId,
        mac: formatDeviceId(root.binding.expectedDeviceId),
        nodeId: 0,
        local: true,
        version: liveSelf?.version,
      };
      const hasLive = root.attachedBackbones.length > 0;
      const remotes = hasLive
        ? root.attachedBackbones.filter((peer) => !peer.local && peer.deviceIdHex !== root.binding.expectedDeviceId)
        : rows
            .filter((row) => row.viaCan?.viaDeviceIdHex === root.binding.expectedDeviceId)
            .map((row) => ({
              deviceIdHex: row.binding.expectedDeviceId,
              mac: formatDeviceId(row.binding.expectedDeviceId),
              nodeId: row.viaCan?.nodeId ?? 0,
              local: false,
              version: row.attachedBackbones.find((peer) => peer.local)?.version,
            }));
      const merged: AttachedBackbone[] = [self];
      const seen = new Set([self.deviceIdHex]);
      for (const peer of remotes) {
        if (seen.has(peer.deviceIdHex)) continue;
        seen.add(peer.deviceIdHex);
        merged.push(peer);
      }
      map.set(root.binding.bindingId, merged);
    }
    return map;
  }, [roots, rows]);

  const total = roots.length;
  const subtitle = total === 0 ? copy.noCoreShort : copy.coresCount(total);
  const listedPeers = useRef(new Set<string>());

  useEffect(() => {
    const ready = roots.filter((row) => row.sessionState === "READY" && !listedPeers.current.has(row.binding.bindingId));
    if (ready.length === 0) return undefined;
    let cancelled = false;
    void probeUsbBridgeCores().then((found) => {
      if (cancelled) return;
      for (const row of ready) {
        listedPeers.current.add(row.binding.bindingId);
        const peers = found
          .filter((core) => core.source === "can" && core.viaDeviceIdHex === row.binding.expectedDeviceId)
          .map((core) => ({
            deviceIdHex: core.deviceIdHex,
            mac: core.source === "can" ? core.mac : formatDeviceId(core.deviceIdHex),
            nodeId: core.source === "can" ? core.nodeId : 0,
            local: false,
            version: core.version || undefined,
          }));
        if (peers.length === 0 && row.attachedBackbones.length > 0) continue;
        const master = found.find((core) => core.deviceIdHex === row.binding.expectedDeviceId);
        setAttachedBackbones(row.binding.bindingId, [
          {
            deviceIdHex: row.binding.expectedDeviceId,
            mac: formatDeviceId(row.binding.expectedDeviceId),
            nodeId: 0,
            local: true,
            version: master?.version || undefined,
          },
          ...peers,
        ]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [roots, setAttachedBackbones]);

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
            {roots.map((row, index) => (
              <CoreRow
                key={row.binding.bindingId}
                row={row}
                groupIndex={index + 1}
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
