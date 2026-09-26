import type { NodeProps } from "@xyflow/react";
import { Cpu } from "lucide-react";

export const DEMO_BACKBONE_FRAME_ID = "demo-backbone-frame";

export type DemoBackboneFrameData = {
  readonly label: string;
  readonly caption: string;
};

/**
 * Visitor-only dashed frame: the LED is a hardware module on the Backbone,
 * commanded by the firmware Flow on the left. Not a domain node.
 */
export function DemoBackboneFrame({ data }: NodeProps & { readonly data: DemoBackboneFrameData }) {
  return (
    <div
      data-tour-target="flow-node-demo-backbone"
      className="flex h-full w-full cursor-default flex-col overflow-visible rounded-slmd border-2 border-dashed"
      style={{
        borderColor: "#64748B",
        backgroundColor: "color-mix(in srgb, #64748B 6%, transparent)",
      }}
    >
      <div className="flex h-8 shrink-0 items-center gap-1.5 px-2">
        <Cpu size={13} className="shrink-0" style={{ color: "#64748B" }} />
        <span className="min-w-0 truncate font-body text-xs font-semibold text-ink-muted">{data.label}</span>
        <span
          className="ml-auto shrink-0 rounded-slsm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide"
          style={{
            color: "#64748B",
            backgroundColor: "color-mix(in srgb, #64748B 12%, transparent)",
          }}
        >
          {data.caption}
        </span>
      </div>
    </div>
  );
}

export const DEMO_BACKBONE_NODE_TYPES = { "demo-backbone": DemoBackboneFrame };
