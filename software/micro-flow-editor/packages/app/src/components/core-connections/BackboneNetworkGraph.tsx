import { Cable, Cpu, Radio, Wifi } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useMemo } from "react";
import {
  layoutBackboneNetwork,
  type NetworkBoard,
} from "../../lib/backbone-network-layout.js";
import { coreConnectionsCopy } from "../../lib/core-connections-copy.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import type { NfcNode } from "../../lib/nfc-presence.js";
import type { LocaleId } from "../../lib/locale.js";

function nodeById(nodes: ReturnType<typeof layoutBackboneNetwork>["nodes"], id: string) {
  return nodes.find((node) => node.id === id);
}

export function BackboneNetworkGraph({
  boards,
  nfcByBoardId,
  nfcLoading,
  locale,
}: {
  readonly boards: readonly NetworkBoard[];
  readonly nfcByBoardId: ReadonlyMap<string, readonly NfcNode[]>;
  readonly nfcLoading: boolean;
  readonly locale: LocaleId;
}) {
  const copy = coreConnectionsCopy(locale);
  const layout = useMemo(() => layoutBackboneNetwork(boards, nfcByBoardId), [boards, nfcByBoardId]);
  const uid = useId().replace(/:/g, "");
  const flow = `sl-net-flow-${uid}`;

  return (
    <div className="relative overflow-hidden rounded-slsm bg-surface-sunken">
      <style>{`
        @keyframes ${flow} { to { stroke-dashoffset: -28; } }
      `}</style>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="block h-[260px] w-full"
        role="img"
        aria-label={copy.attachedCount(boards.length)}
      >
        <defs>
          <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-brand-cyan-glow)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-brand-cyan-glow)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${uid}-can`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--color-brand-blue)" />
            <stop offset="100%" stopColor="var(--color-brand-cyan-glow)" />
          </linearGradient>
        </defs>

        {layout.nodes
          .filter((node) => node.kind === "backbone")
          .map((node) => (
            <circle key={`glow-${node.id}`} cx={node.x} cy={node.y} r={78} fill={`url(#${uid}-glow)`} />
          ))}

        {layout.edges.map((edge) => {
          const from = nodeById(layout.nodes, edge.from);
          const to = nodeById(layout.nodes, edge.to);
          if (!from || !to) return null;
          const can = edge.kind === "can";
          const host = edge.kind === "host";
          const path = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
          return (
            <g key={edge.id}>
              <path
                d={path}
                fill="none"
                stroke={can ? `url(#${uid}-can)` : host ? "var(--color-ink-muted)" : "var(--color-border-strong)"}
                strokeWidth={can ? 4 : host ? 2.5 : 1.5}
                strokeLinecap="round"
                strokeDasharray={can ? "7 7" : host ? undefined : "3 5"}
                style={can || !host ? { animation: `${flow} ${can ? 1.4 : 2.2}s linear infinite` } : undefined}
              />
              {can && (
                <circle r="3.5" fill="var(--color-brand-cyan-glow)">
                  <animateMotion dur="2.2s" repeatCount="indefinite" path={path} />
                </circle>
              )}
            </g>
          );
        })}

        {layout.nodes.map((node, index) => {
          const isBackbone = node.kind === "backbone";
          const isHost = node.kind === "host";
          const empty = node.kind === "nfc-empty";
          const fill = isBackbone || isHost
            ? "var(--color-surface)"
            : empty
              ? "var(--color-surface-sunken)"
              : "var(--color-surface)";
          const stroke = isBackbone
            ? "var(--color-brand-blue)"
            : isHost
              ? "var(--color-ink-muted)"
              : empty
                ? "var(--color-border-strong)"
                : "var(--color-brand-purple-glow)";
          return (
            <motion.g
              key={node.id}
              initial={{ opacity: 0, scale: 0.86 }}
              animate={{ opacity: empty ? 0.55 : 1, scale: 1 }}
              transition={{ ...motionTokens.spring.smooth, delay: index * motionTokens.stagger.list }}
            >
              {isBackbone && (
                <motion.circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r + 7}
                  fill="none"
                  stroke="var(--color-brand-blue)"
                  strokeOpacity={0.28}
                  animate={{ r: [node.r + 6, node.r + 12, node.r + 6], opacity: [0.35, 0.08, 0.35] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill={fill}
                stroke={stroke}
                strokeWidth={isBackbone ? 2 : 1.5}
                strokeDasharray={empty ? "3 3" : undefined}
              />
              <foreignObject x={node.x - 10} y={node.y - 10} width={20} height={20}>
                <div className="flex h-full w-full items-center justify-center">
                  {isHost ? (
                    node.hostLink === "wifi" ? (
                      <Wifi size={13} style={{ color: "var(--color-ink-muted)" }} />
                    ) : (
                      <Cable size={13} style={{ color: "var(--color-ink-muted)" }} />
                    )
                  ) : isBackbone ? (
                    <Cpu size={14} style={{ color: "var(--color-brand-blue)" }} />
                  ) : (
                    <Radio size={11} style={{ color: empty ? "var(--color-ink-faint)" : "var(--color-brand-purple-glow)" }} />
                  )}
                </div>
              </foreignObject>
              {(node.label || empty) && (
                <text
                  x={node.x}
                  y={node.y + node.r + (isBackbone ? 16 : 14)}
                  textAnchor="middle"
                  fill={empty ? "var(--color-ink-faint)" : "var(--color-ink)"}
                  fontSize={isBackbone ? 11 : 9}
                  fontFamily="var(--font-body)"
                >
                  {empty ? copy.nfcEmptyShort : node.label}
                </text>
              )}
              {node.sublabel && (
                <text
                  x={node.x}
                  y={node.y + node.r + (isBackbone ? 28 : 24)}
                  textAnchor="middle"
                  fill="var(--color-ink-faint)"
                  fontSize={9}
                  fontFamily="var(--font-body)"
                >
                  {node.sublabel}
                </text>
              )}
            </motion.g>
          );
        })}
      </svg>
      <AnimatePresence>
        {nfcLoading && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTokens.duration.fast}
            className="absolute bottom-2 left-0 right-0 text-center font-body text-xs text-ink-faint"
          >
            {copy.nfcReading}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
