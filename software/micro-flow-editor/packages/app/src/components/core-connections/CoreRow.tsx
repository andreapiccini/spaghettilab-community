import { Cable, CloudOff, Wifi } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { motionTokens } from "../../lib/motion-tokens.js";
import { coreConnectionsCopy } from "../../lib/core-connections-copy.js";
import { formatDeviceId } from "../../lib/core-identity.js";
import type { AttachedBackbone, CoreRowState } from "../../state/core-sessions-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { nfcNodesForBoard } from "../../lib/nfc-presence.js";
import { useNfcPresence } from "../../state/nfc-presence-context.js";
import { BackboneNetworkGraph } from "./BackboneNetworkGraph.js";
import { useSession } from "../../state/session-context.js";
import { rowActionId, rowActionLabel, sessionBadgeStyle } from "./session-badge.js";

const TRANSITIONAL = new Set(["CONNECTING", "AUTHENTICATING", "SYNCHRONIZING", "VALIDATING", "APPLYING", "UPDATING", "REBOOTING", "TRIAL"]);

function isTechnicalDeviceLabel(name: string | undefined, deviceIdHex: string): boolean {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (lower === formatDeviceId(deviceIdHex).toLowerCase()) return true;
  if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(trimmed)) return true;
  if (/^[0-9a-f]{12,}$/i.test(trimmed.replace(/[^0-9a-f]/gi, ""))) return true;
  return false;
}

export function CoreRow({
  row,
  attached,
  clusterIndex,
  onConnect,
}: {
  readonly row: CoreRowState;
  readonly attached: readonly AttachedBackbone[];
  readonly clusterIndex: number;
  readonly onConnect: () => void;
}) {
  const { cancel } = useCoreSessions();
  const { nodesByBinding, loadingBindings } = useNfcPresence();
  const { locale } = useLocale();
  const { openBackbonePhysical } = useSession();
  const copy = coreConnectionsCopy(locale);
  const nfcNodes = nodesByBinding.get(row.binding.bindingId) ?? [];
  const nfcLoading = loadingBindings.has(row.binding.bindingId);
  const hasError = row.error !== null && (row.sessionState === "DISCONNECTED" || row.sessionState === "ERROR");
  const badge = sessionBadgeStyle(row.sessionState, copy.online);
  const actionId = row.sessionState === "READY" ? null : rowActionId(row.sessionState, row.stale, row.syncRelationship, hasError);
  const action = actionId ? rowActionLabel(actionId, locale) : null;
  const showStale = row.sessionState === "DISCONNECTED" && row.stale && !hasError;
  const isErrorLike = row.sessionState === "ERROR" || row.sessionState === "CONFLICT" || hasError;
  const chain: readonly AttachedBackbone[] = attached.length > 0
    ? attached
    : [{ deviceIdHex: row.binding.expectedDeviceId, mac: "", nodeId: 0, local: true }];
  const HostIcon = row.hostLink === "wifi" ? Wifi : Cable;
  const nfcTotal = chain.reduce((sum, board) => sum + nfcNodesForBoard(board, nfcNodes).length, 0);

  function handleAction() {
    if (actionId === "connect" || actionId === "reconnect" || actionId === "review-error") onConnect();
    else if (actionId === "cancel") cancel(row.binding.bindingId);
  }

  const title = isTechnicalDeviceLabel(row.displayName, row.binding.expectedDeviceId)
    ? copy.clusterTitle(clusterIndex)
    : row.displayName.trim();

  return (
    <motion.div
      layout
      className="rounded-slmd border bg-surface p-4 shadow-e1 hover:shadow-e2"
      style={{ borderColor: isErrorLike ? "var(--color-error)" : "var(--color-border)", borderWidth: isErrorLike ? 2 : 1 }}
    >
      <div className="flex min-h-10 items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-slsm" style={{ backgroundColor: `color-mix(in srgb, ${badge.colorVar} 12%, transparent)` }}>
          <HostIcon size={20} style={{ color: badge.colorVar }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate font-body text-sm font-semibold text-ink">{title}</div>
          <div className="font-body text-xs text-ink-muted">
            {copy.linkToSoftware(row.hostLink === "wifi" ? "wifi" : "cable")}
            {" · "}
            {copy.clusterSummary(chain.length, nfcTotal)}
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
        <BackboneNetworkGraph
          boards={chain.map((board, index) => {
            const boardNfc = nfcNodesForBoard(board, nfcNodes);
            const roleLabel = board.local || index === 0 ? copy.masterBackbone : copy.chainedBackbone(index + 1);
            return {
              id: board.deviceIdHex,
              label: roleLabel,
              sublabel: [
                `ID ${board.mac || formatDeviceId(board.deviceIdHex)}`,
                board.version?.trim() ? copy.fwVersion(board.version.trim()) : null,
                copy.nfcCountShort(boardNfc.length),
              ]
                .filter(Boolean)
                .join(" · "),
              local: board.local,
              hostLink: board.local ? row.hostLink : "can",
            };
          })}
          nfcByBoardId={new Map(chain.map((board) => [board.deviceIdHex, nfcNodesForBoard(board, nfcNodes)]))}
          nfcLoading={nfcLoading && (row.sessionState === "READY" || row.sessionState === "SYNCHRONIZING")}
          locale={locale}
          onBoardClick={(deviceIdHex) =>
            openBackbonePhysical(row.binding.bindingId, deviceIdHex)
          }
        />
      </div>
    </motion.div>
  );
}
