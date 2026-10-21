import { Cable, GitFork, Radio, Server, Wifi } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import type { NetworkBoard } from "../../lib/backbone-network-layout.js";
import { coreConnectionsCopy } from "../../lib/core-connections-copy.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import type { NfcNode } from "../../lib/nfc-presence.js";
import type { LocaleId } from "../../lib/locale.js";
import "./can-network.css";

const NFC_PARTICLES = Array.from({ length: 16 }, (_, index) => {
  const angle = (index / 16) * Math.PI * 2 + (index % 2) * 0.18;
  const distance = 46 + (index % 4) * 12;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    delay: (index % 4) * 0.04,
    size: index % 3 === 0 ? 6 : 4,
  };
});

export function BackboneNetworkGraph({
  boards,
  nfcByBoardId,
  nfcLoading,
  locale,
  onBoardClick,
}: {
  readonly boards: readonly NetworkBoard[];
  readonly nfcByBoardId: ReadonlyMap<string, readonly NfcNode[]>;
  readonly nfcLoading: boolean;
  readonly locale: LocaleId;
  readonly onBoardClick?: (boardId: string) => void;
}) {
  const copy = coreConnectionsCopy(locale);
  const reducedMotion = useReducedMotion();
  const it = locale === "it";

  const listRef = useRef<HTMLOListElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const nodes = list.querySelectorAll<HTMLElement>(".can-network-node");
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      setLineHeight(first && last && nodes.length > 1 ? last.offsetTop - first.offsetTop : 0);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    measure();
    return () => observer.disconnect();
  }, [boards.length]);

  return (
    <section className="can-network" aria-label={it ? "Rete CAN" : "CAN network"}>
      <ol className="can-network-list" ref={listRef}>
        {lineHeight > 0 && (
          <li className="can-network-line" style={{ height: lineHeight }} aria-hidden>
            {!reducedMotion && <span className="can-network-signal" />}
          </li>
        )}
        <AnimatePresence initial={false}>
          {boards.map((board) => (
            <CanNetworkNode
              key={board.id}
              board={board}
              tags={nfcByBoardId.get(board.id) ?? []}
              nfcLoading={nfcLoading}
              locale={locale}
              reducedMotion={reducedMotion === true}
              onBoardClick={onBoardClick}
            />
          ))}
        </AnimatePresence>
      </ol>
      <AnimatePresence>
        {nfcLoading && (
          <motion.p
            className="can-network-loading"
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {copy.nfcReading}
          </motion.p>
        )}
      </AnimatePresence>
    </section>
  );
}

function CanNetworkNode({
  board,
  tags,
  nfcLoading,
  locale,
  reducedMotion,
  onBoardClick,
}: {
  readonly board: NetworkBoard;
  readonly tags: readonly NfcNode[];
  readonly nfcLoading: boolean;
  readonly locale: LocaleId;
  readonly reducedMotion: boolean;
  readonly onBoardClick?: (boardId: string) => void;
}) {
  const it = locale === "it";
  const reader = board.productKind === "nfc-reader";
  const master = board.local && !reader;
  const burst = useReaderScanBurst(tags, reader, nfcLoading);
  const Icon = reader ? Radio : Server;
  const role = master ? "Master" : "Backbone";
  const content = (
    <>
      <span className={`can-network-icon ${reader ? "is-reader" : ""}`}>
        {reader && burst > 0 && !reducedMotion && <NfcScanBurst key={burst} />}
        <Icon size={23} strokeWidth={1.7} aria-hidden />
      </span>
      <span className="can-network-info">
        <strong>{board.label}</strong>
        {!reader && (
          <span className={`can-network-role ${master ? "is-master" : ""}`}>{role}</span>
        )}
        <span className="can-network-meta">{board.sublabel}</span>
        <span className="can-network-host">
          {board.local
            ? board.hostLink === "wifi" ? <Wifi size={11} aria-hidden /> : <Cable size={11} aria-hidden />
            : <GitFork size={11} aria-hidden />}
          {board.local ? board.hostLink === "wifi" ? "Wi-Fi" : "USB" : "CAN"}
        </span>
        {reader && (
          <span className="can-network-tags">
            {tags.length === 0 ? (
              <span className="is-empty">{it ? "Nessun tag rilevato" : "No tag detected"}</span>
            ) : (
              tags.map((tag) => (
                <span key={`${tag.portId}:${tag.uid ?? tag.label}`} className={reducedMotion ? undefined : "is-live"}>
                  {!reducedMotion && <TagRgbOrbit />}
                  <span className="can-network-tag-face">
                    <Radio size={11} aria-hidden />
                    {tag.label}
                    {tag.uid && <small>{tag.uid}</small>}
                  </span>
                </span>
              ))
            )}
          </span>
        )}
      </span>
    </>
  );

  return (
    <motion.li
      layout
      className="can-network-node"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={reducedMotion ? { duration: 0 } : motionTokens.spring.smooth}
    >
      <span
        className={`can-network-junction ${master ? "is-master" : ""} ${reader ? "is-reader" : ""}`}
        aria-hidden
      />
      {!reader && onBoardClick ? (
        <button
          type="button"
          className="can-network-card"
          onClick={() => onBoardClick(board.id)}
          aria-label={`${board.label}: ${board.sublabel}`}
        >
          {content}
        </button>
      ) : (
        <div className="can-network-card">{content}</div>
      )}
    </motion.li>
  );
}

function TagRgbOrbit() {
  const gradientId = useId().replace(/:/g, "");
  const path =
    "M 7 1 H 93 A 6 6 0 0 1 99 7 V 21 A 6 6 0 0 1 93 27 H 7 A 6 6 0 0 1 1 21 V 7 A 6 6 0 0 1 7 1";
  return (
    <svg
      className="can-network-tag-ring"
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="100"
          y2="28"
        >
          <stop offset="0" stopColor="#ff5a5a" />
          <stop offset="0.2" stopColor="#ff9a2e" />
          <stop offset="0.4" stopColor="#ffe14a" />
          <stop offset="0.6" stopColor="#3dce6e" />
          <stop offset="0.8" stopColor="#3ec6ff" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path
        className="can-network-tag-comet is-glow"
        d={path}
        pathLength="100"
        fill="none"
        stroke={`url(#${gradientId})`}
      />
      <path
        className="can-network-tag-comet is-soft"
        d={path}
        pathLength="100"
        fill="none"
        stroke={`url(#${gradientId})`}
      />
      <path
        className="can-network-tag-comet"
        d={path}
        pathLength="100"
        fill="none"
        stroke={`url(#${gradientId})`}
      />
    </svg>
  );
}

/** Glow only for a tag that appears after Discover has already settled. */
function useReaderScanBurst(
  tags: readonly NfcNode[],
  enabled: boolean,
  loading: boolean,
): number {
  const tagKey = tags.map((tag) => `${tag.portId}:${tag.uid ?? ""}:${tag.label}`).join("\n");
  const primed = useRef(false);
  const seen = useRef("");
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (!enabled || loading) return;
    if (!primed.current) {
      primed.current = true;
      seen.current = tagKey;
      return;
    }
    if (tagKey === seen.current) return;
    const previous = new Set(seen.current.split("\n").filter(Boolean));
    seen.current = tagKey;
    if (tagKey.split("\n").some((item) => item && !previous.has(item))) {
      setBurst((count) => count + 1);
    }
  }, [enabled, loading, tagKey]);
  return burst;
}

function NfcScanBurst() {
  return (
    <>
      <span className="can-network-burst-glow" aria-hidden />
      <span className="can-network-burst-ring" aria-hidden />
      <span className="can-network-particles" aria-hidden>
        {NFC_PARTICLES.map((particle, index) => (
          <span
            key={index}
            className="can-network-particle"
            style={{
              ["--x" as string]: `${particle.x}px`,
              ["--y" as string]: `${particle.y}px`,
              animationDelay: `${particle.delay}s`,
              width: particle.size,
              height: particle.size,
            }}
          />
        ))}
      </span>
    </>
  );
}
