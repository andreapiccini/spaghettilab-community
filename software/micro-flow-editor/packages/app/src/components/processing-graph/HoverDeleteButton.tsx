import { useReactFlow } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import { DEMO_SEEDED_NODE_IDS, isDemoOnlyEnabled } from "../../lib/demo-only.js";

/**
 * Hover/select trash sitting just outside the top-right corner of a canvas
 * card or dashed container. Click goes through React Flow `deleteElements`
 * (same path as the edge trash), which becomes `removeGraphNodeCommand`.
 * Nested members of a dashed box are included so deleting the box does not
 * leave orphan parentId children on the pane.
 */
export function HoverDeleteButton({
  id,
  label,
  forceVisible = false,
  corner = "right",
}: {
  readonly id: string;
  readonly label: string;
  readonly forceVisible?: boolean;
  /** Multi-output cards keep the trash on the left so it doesn't cover channel handles. */
  readonly corner?: "left" | "right";
}) {
  const { deleteElements, getNodes } = useReactFlow();
  if (isDemoOnlyEnabled() && DEMO_SEEDED_NODE_IDS.has(id)) return null;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const nodes = getNodes();
    const ids = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of nodes) {
        if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
          ids.add(node.id);
          grew = true;
        }
      }
    }
    void deleteElements({ nodes: [...ids].map((nodeId) => ({ id: nodeId })) });
  }

  const cornerClass = corner === "left" ? "-left-3 -top-3" : "-right-3 -top-3";

  return (
    <button
      type="button"
      aria-label={label}
      className={`nodrag nopan absolute ${cornerClass} z-20 flex h-7 w-7 items-center justify-center rounded-full border border-border-strong bg-surface text-ink-muted shadow-e1 hover:border-error hover:text-error ${forceVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={handleClick}
    >
      <Trash2 size={14} />
    </button>
  );
}
