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
      }
    | undefined;
  const pulse = activity?.signalPulse;
  const preview = activity?.previewSignal === true;
  const signalColor = pulse?.kind === "data" ? "#4CA5A6" : "var(--color-brand-blue)";

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
    // Start relative to the received packet, not to the SVG document's age.
    for (const element of signalRef.current?.querySelectorAll<SVGAnimationElement>(
      "animate, animateMotion",
    ) ?? [])
      element.beginElementAt(Number(element.getAttribute("data-delay") ?? 0));
  }, [pulse?.token, preview, edgePath]);

  const showDelete = hovered || selected || invalid;
  const stroke = invalid
    ? "var(--color-error)"
    : showDelete
      ? "var(--color-brand-blue)"
      : typeof style?.stroke === "string"
        ? style.stroke
        : "var(--color-ink-faint)";
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
        >
          <path
            d={edgePath}
            fill="none"
            stroke={signalColor}
            strokeWidth={3}
            className="edge-signal-highlight"
          >
            <animate
              begin="indefinite"
              attributeName="opacity"
              values="0.7;0.3;0"
              dur="0.85s"
              repeatCount={preview ? "indefinite" : 1}
              fill="freeze"
            />
          </path>
          {[0, 0.09, 0.18].map((delay, index) => (
            <circle
              key={index}
              r={index === 0 ? 3.5 : 2.5}
              fill={signalColor}
              stroke="var(--color-surface)"
              strokeWidth={1}
              opacity={0}
              className="edge-signal-packet"
            >
              <animateMotion
                path={edgePath}
                dur="0.6s"
                begin="indefinite"
                data-delay={delay}
                calcMode="paced"
                repeatCount={preview ? "indefinite" : 1}
                fill="freeze"
              />
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.08;0.85;1"
                dur="0.6s"
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
      />
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
