import { SIGNAL_STYLES, type WireSignalType } from "./signal-colors.js";
import { SIGNAL_TRAVEL_MS } from "../../lib/edge-activity.js";
import "./edge-signals.css";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  useNodes,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { Unlink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  leadFromHandle,
  obstacleRectsForEdge,
  pathMidpoint,
  roundedOrthogonalPath,
  routeOrthogonal,
  simplifyAxisAligned,
  type Point,
} from "./orthogonal-route.js";

function handleSide(position: Position): "left" | "right" | "top" | "bottom" {
  if (position === Position.Left) return "left";
  if (position === Position.Right) return "right";
  if (position === Position.Top) return "top";
  return "bottom";
}

/**
 * Processing Graph edge: hovering the wire (or selecting it) shows a broken-link
 * control on the midpoint. Pointer down is stopped so the first click deletes
 * (React Flow would otherwise select the edge and swallow the click). Keyboard
 * Backspace/Delete still works on a selected edge (`deleteKeyCode` on the pane).
 *
 * Routed as a handful of horizontal/vertical segments with rounded corners
 * only at 90° joins — never a grid staircase or a free diagonal.
 */
function edgeMarkedInvalid(data: unknown): boolean {
  return (
    !!data &&
    typeof data === "object" &&
    "invalid" in data &&
    (data as { invalid?: unknown }).invalid === true
  );
}

export function DeletableEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  selected,
  data,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const { deleteElements } = useReactFlow();
  const nodes = useNodes();
  const invalid = edgeMarkedInvalid(data);
  const activity = data as
    | {
        signalPulse?: { token: number; kind: "trigger" | "data" };
        previewSignal?: boolean;
        signalType?: WireSignalType;
      }
    | undefined;
  const pulse = activity?.signalPulse;
  const preview = activity?.previewSignal === true;
  const signalStyle = SIGNAL_STYLES[activity?.signalType ?? "any"];
  const signalColor = signalStyle.color;

  const { edgePath, labelX, labelY } = useMemo(() => {
    if (![sourceX, sourceY, targetX, targetY].every(Number.isFinite)) {
      return { edgePath: "", labelX: 0, labelY: 0 };
    }
    const start: Point = { x: sourceX, y: sourceY };
    const end: Point = { x: targetX, y: targetY };
    const leadStart = leadFromHandle(start, handleSide(sourcePosition));
    const leadEnd = leadFromHandle(end, handleSide(targetPosition));
    const obstacles = obstacleRectsForEdge(nodes, source, target);
    const mid = routeOrthogonal(leadStart, leadEnd, obstacles);
    const points = simplifyAxisAligned([start, ...mid, end]);
    const path = roundedOrthogonalPath(points);
    const label = pathMidpoint(points);
    return { edgePath: path, labelX: label.x, labelY: label.y };
  }, [
    nodes,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  ]);

  const signalRef = useRef<SVGGElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Start relative to the visual departure, not the SVG document's age.
    for (const element of signalRef.current?.querySelectorAll<SVGAnimationElement>(
      "animate, animateMotion",
    ) ?? [])
      element.beginElementAt(Number(element.getAttribute("data-delay") ?? 0));
  }, [pulse?.token, preview, edgePath]);

  const showDelete = hovered || selected || invalid;
  const stroke = invalid ? "var(--color-error)" : signalColor;
  const markerId = `edge-arrow-${id}`;

  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 8 8"
          markerWidth={7}
          markerHeight={7}
          refX={7}
          refY={4}
          orient="auto"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill={stroke} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={`url('#${markerId}')`}
        style={{
          ...style,
          stroke,
          strokeWidth: showDelete ? 2.5 : 1.6,
          strokeDasharray: invalid ? "6 4" : style?.strokeDasharray,
        }}
      />
      {!invalid && edgePath && (pulse || preview) && (
        <g
          ref={signalRef}
          key={pulse?.token ?? "preview"}
          aria-hidden="true"
          pointerEvents="none"
          data-signal-kind={pulse?.kind ?? "trigger"}
          style={{ color: signalColor }}
        >
          <path
            d={edgePath}
            fill="none"
            stroke={signalColor}
            strokeWidth={2.5}
            className="edge-signal-highlight"
          >
            <animate
              begin="indefinite"
              attributeName="opacity"
              values="0;0.32;0.12;0"
              keyTimes="0;0.22;0.55;1"
              dur="0.48s"
              repeatCount={preview ? "indefinite" : 1}
              fill="freeze"
            />
          </path>
          {Array.from({ length: 6 }, (_, index) => index * 0.009).map((delay, index) => (
            <circle
              key={index}
              r={index === 0 ? 3 : Math.max(0.8, 2.4 - index * 0.32)}
              fill={index === 0 ? "white" : signalColor}
              style={{ color: signalColor }}
              stroke={signalColor}
              strokeWidth={index === 0 ? 2 : 0}
              opacity={0}
              className="edge-signal-packet"
            >
              <animateMotion
                path={edgePath}
                dur={`${SIGNAL_TRAVEL_MS}ms`}
                begin="indefinite"
                data-delay={delay}
                calcMode="paced"
                repeatCount={preview ? "indefinite" : 1}
                fill="freeze"
              />
              <animate
                attributeName="opacity"
                values={`0;${1 - index * 0.045};${1 - index * 0.045};0`}
                keyTimes="0;0.08;0.85;1"
                dur={`${SIGNAL_TRAVEL_MS}ms`}
                begin="indefinite"
                data-delay={delay}
                repeatCount={preview ? "indefinite" : 1}
                fill="freeze"
              />
            </circle>
          ))}
        </g>
      )}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        className="react-flow__edge-interaction"
        style={{ pointerEvents: "stroke" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      ><title>{signalStyle.label}</title></path>
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            zIndex: 1001,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {showDelete && (
            <button
              type="button"
              aria-label={invalid ? "Broken connection" : "Scollega"}
              title={invalid ? "Broken connection" : undefined}
              className={`flex h-7 w-7 items-center justify-center rounded-full border bg-surface shadow-e1 ${
                invalid
                  ? "border-error text-error"
                  : "border-border-strong text-ink-muted hover:border-error hover:text-error"
              }`}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void deleteElements({ edges: [{ id }] });
              }}
            >
              <Unlink size={14} />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const PROCESSING_EDGE_TYPES = { deletable: DeletableEdge };
