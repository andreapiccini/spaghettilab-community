import { Cable, CloudOff, Cpu, Wifi } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { motionTokens } from "../../lib/motion-tokens.js";
import { formatDeviceId } from "../../lib/core-identity.js";
import { coreConnectionsCopy } from "../../lib/core-connections-copy.js";
import type { AttachedBackbone, CoreRowState } from "../../state/core-sessions-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { useNfcPresence } from "../../state/nfc-presence-context.js";
import { BackboneNetworkGraph } from "./BackboneNetworkGraph.js";
import { rowActionId, rowActionLabel, sessionBadgeStyle } from "./session-badge.js";

const TRANSITIONAL = new Set(["CONNECTING", "AUTHENTICATING", "SYNCHRONIZING", "VALIDATING", "APPLYING", "UPDATING", "REBOOTING", "TRIAL"]);

export function CoreRow({
  row,
  groupIndex,
  attached,
  onConnect,
}: {
  readonly row: CoreRowState;
  readonly groupIndex: number;
  readonly attached: readonly AttachedBackbone[];
  readonly onConnect: () => void;
}) {
  const { cancel } = useCoreSessions();
  const { nodesByBinding, loadingBindings } = useNfcPresence();
  const { locale } = useLocale();
  const copy = coreConnectionsCopy(locale);
  const nfcNodes = nodesByBinding.get(row.binding.bindingId) ?? [];
  const nfcLoading = loadingBindings.has(row.binding.bindingId);
  const hasError = row.error !== null && row.sessionState === "DISCONNECTED";
  const badge = sessionBadgeStyle(row.sessionState, copy.online);
  const actionId = row.sessionState === "READY" ? null : rowActionId(row.sessionState, row.stale, row.syncRelationship, hasError);
  const action = actionId ? rowActionLabel(actionId, locale) : null;
  const showStale = row.sessionState === "DISCONNECTED" && row.stale && !hasError;
  const isErrorLike = row.sessionState === "ERROR" || row.sessionState === "CONFLICT" || hasError;
  const chain: readonly AttachedBackbone[] = attached.length > 0
    ? attached
    : [{ deviceIdHex: row.binding.expectedDeviceId, mac: formatDeviceId(row.binding.expectedDeviceId), nodeId: 0, local: true }];
  const HostIcon = row.hostLink === "wifi" ? Wifi : Cable;

  function handleAction() {
    if (actionId === "connect" || actionId === "reconnect" || actionId === "review-error") onConnect();
    else if (actionId === "cancel") cancel(row.binding.bindingId);
  }

  let slaveIndex = 0;

  return (
    <motion.div
      layout
      className="rounded-slmd border bg-surface p-4 shadow-e1 hover:shadow-e2"
      style={{ borderColor: isErrorLike ? "var(--color-error)" : "var(--color-border)", borderWidth: isErrorLike ? 2 : 1 }}
    >
      <div className="flex min-h-10 items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-slsm" style={{ backgroundColor: `color-mix(in srgb, ${badge.colorVar} 12%, transparent)` }}>
          <Cpu size={20} style={{ color: badge.colorVar }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate font-body text-sm font-semibold text-ink">{copy.groupTitle(groupIndex)}</div>
          <div className="flex items-center gap-1.5 font-body text-xs text-ink-muted">
            <HostIcon size={12} />
            {row.hostLink === "wifi" ? copy.viaWifi : copy.viaCable}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {hasError ? (
            <motion.div key="conn-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTokens.duration.base} className="flex items-center gap-1.5 rounded-slpill px-2 py-0.5 text-xs" style={{ backgroundColor: "color-mix(in srgb, var(--color-error) 12%, transparent)", color: "var(--color-error)" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--color-error)" }} />
              {copy.error}
            </motion.div>
          ) : showStale ? (
            <motion.div key="stale" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTokens.duration.base} className="flex items-center gap-1.5 rounded-slpill bg-ink-faint/12 px-2 py-0.5 text-xs text-ink-muted">
              <CloudOff size={12} />
              stale
            </motion.div>
          ) : (
            <motion.div key={row.sessionState} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTokens.duration.base} className="flex items-center gap-1.5 rounded-slpill px-2 py-0.5 text-xs" style={{ backgroundColor: `color-mix(in srgb, ${badge.colorVar} 12%, transparent)`, color: badge.colorVar }}>
              <motion.span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: badge.colorVar }}
                animate={TRANSITIONAL.has(row.sessionState) ? { opacity: [0.4, 1, 0.4] } : {}}
                transition={TRANSITIONAL.has(row.sessionState) ? { duration: 1.2, repeat: Infinity, ease: "linear" } : undefined}
              />
              {badge.label}
            </motion.div>
          )}
        </AnimatePresence>

        {action && (
          <button type="button" onClick={handleAction} className="ml-auto h-9 shrink-0 rounded-slsm border border-border-strong px-3 text-sm font-body text-ink hover:bg-surface-raised">
            {action}
          </button>
        )}
        {row.sessionState === "READY" && (
          <button type="button" onClick={() => cancel(row.binding.bindingId)} className={`h-9 shrink-0 rounded-slsm border border-border-strong px-3 text-sm font-body text-ink-muted hover:bg-surface-raised ${action ? "" : "ml-auto"}`}>
            {copy.disconnect}
          </button>
        )}
      </div>

      {hasError && row.error && (
        <p className="mt-3 font-body text-sm text-error">{typeof row.error === "string" ? row.error : row.error.remediation}</p>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <p className="mb-2 font-body text-xs font-semibold text-ink-muted">{copy.attachedCount(chain.length)}</p>
        <BackboneNetworkGraph
          boards={chain.map((board) => {
            const role = board.local ? copy.master : copy.slave(++slaveIndex);
            const link = board.local ? (row.hostLink === "wifi" ? copy.viaWifi : copy.viaCable) : copy.viaCanShort;
            return {
              id: board.deviceIdHex,
              label: role,
              sublabel: board.version ? board.version : link,
              local: board.local,
              hostLink: board.local ? row.hostLink : "can",
            };
          })}
          nfcByBoardId={new Map(chain.filter((board) => board.local).map((board) => [board.deviceIdHex, nfcNodes]))}
          nfcLoading={nfcLoading && row.sessionState === "READY"}
          locale={locale}
        />
      </div>
    </motion.div>
  );
}
