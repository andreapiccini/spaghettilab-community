import { useEffect, useRef, useState } from "react";
import { SIGNAL_TRAVEL_MS } from "../../lib/edge-activity.js";

type Pulse = { token: number; kind: "trigger" | "data" };
type Connection = { id: string; source: string; target: string };

/** Arrival pulses have their own lifetime; outgoing telemetry cannot cancel them. */
export function useSignalNodeGlow(
  pulses: ReadonlyMap<string, Pulse>,
  edges: readonly Connection[],
  bindingId: string | undefined,
) {
  const [glows, setGlows] = useState<ReadonlyMap<string, Pulse>>(new Map());
  const seen = useRef(new Map<string, number>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const nodeTokens = useRef(new Map<string, number>());

  useEffect(() => {
    seen.current.clear();
    nodeTokens.current.clear();
    setGlows(new Map());
    return () => {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
    };
  }, [bindingId]);

  useEffect(() => {
    function later(callback: () => void, delay: number) {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        callback();
      }, delay);
      timers.current.add(timer);
    }
    function illuminate(id: string, pulse: Pulse) {
      const token = (nodeTokens.current.get(id) ?? 0) + 1;
      nodeTokens.current.set(id, token);
      setGlows(previous => new Map(previous).set(id, { ...pulse, token }));
      later(() => setGlows(previous => {
        if (previous.get(id)?.token !== token) return previous;
        const next = new Map(previous);
        next.delete(id);
        return next;
      }), 460);
    }
    for (const edge of edges) {
      const pulse = pulses.get(edge.id);
      if (!pulse || seen.current.get(edge.id) === pulse.token) continue;
      seen.current.set(edge.id, pulse.token);
      // A generator lights on emission. Other blocks light only on arrival,
      // so their outgoing value does not restart an incoming glow.
      if (!edges.some(candidate => candidate.target === edge.source)) {
        illuminate(edge.source, pulse);
      }
      later(() => illuminate(edge.target, pulse), SIGNAL_TRAVEL_MS);
    }
  }, [pulses, edges]);

  return glows;
}
