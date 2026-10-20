import { SIGNAL_STYLES } from "./signal-colors.js";
import { BlockInfoButton } from "./BlockInfoButton.js";
import { SignalGeneratorControl } from "./SignalGeneratorControl.js";
import { ManualTriggerControl } from "./ManualTriggerControl.js";
import { DataViewerValue } from "./DataViewerValue.js";
import { ModuleArtwork } from "../hardware/ModuleArtwork.js";
import { Handle as FlowHandle, useNodeId, useStore, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { useLayoutEffect, type ComponentProps, type CSSProperties } from "react";
import {
  ListOrdered,
  Cable,
  Cpu,
  GitBranch,
  Palette,
  Power,
  Thermometer,
  ToggleLeft,
} from "lucide-react";
import { processingGraphCopy } from "../../lib/processing-graph-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { FLOW_START_COLOR } from "./block-visuals.js";
import {
  lineHighAtElapsed,
  lineHighAtTick,
  waveformPlateaus,
  type ToggleMode,
} from "./dry-run-preview.js";
import { HoverDeleteButton } from "./HoverDeleteButton.js";
import {
  INTERNAL_LED_FIRST_PORT_Y,
  INTERNAL_LED_PORT_SPACING,
  FLOW_START_SIZE,
  IF_FOOTER_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "./layout-constants.js";
import { PROCESSING_NODE_KIND_CONFIG } from "./node-kinds.js";
import {
  nodeShellRadius,
  SOURCE_HANDLE_STYLE,
  stackedHandleTop,
  type PortKind,
} from "./node-ports.js";
import type { ProcessingNodeUiData } from "./to-nodes.js";

/** Slate chrome for hardware bay endpoints — distinct from solid functionality cards. */
const BAY_EDGE = "#64748B";
const CHANNEL_ROW_H = 22;

/**
 * Canvas card: n8n-like (solid icon tile + title/subtitle).
 * LED: filled swatch. Toggle: waveform. Flow Start: bare dark-violet disc —
 * the movable Schedule tick plug you wire to the first block inside the box.
 * Bay hardware: dashed slate shell + CPU badge (vs solid functionality blocks).
 * Multi-channel (Terminal block): named rows with a handle beside each label.
 */
export function ProcessingNode({
  id,
  data,
  selected,
}: NodeProps & { readonly data: ProcessingNodeUiData }) {
  const { locale } = useLocale();
  const updateNodeInternals = useUpdateNodeInternals();
  const portLayoutKey = JSON.stringify([data.statusLed, data.logicIf, data.cardWidth, data.cardHeight, data.inputHandles, data.outputHandles]);
  useLayoutEffect(() => { updateNodeInternals(id); }, [id, portLayoutKey, updateNodeInternals]);
  const copy = processingGraphCopy(locale);
  const config = PROCESSING_NODE_KIND_CONFIG[data.kind];
  const Icon =
    data.tileGlyph === "sequence"
      ? ListOrdered
      : data.tileGlyph === "toggle"
        ? ToggleLeft
        : data.tileGlyph === "palette"
          ? Palette
          : data.tileGlyph === "power"
            ? Power
            : data.tileGlyph === "cable"
              ? Cable
              : data.tileGlyph === "if"
                ? GitBranch
                : data.tileGlyph === "thermometer"
                  ? Thermometer
                  : config.icon;
  const inputHandles = data.inputHandles ?? (data.hasInput ? [{ id: "0" }] : []);
  const outputHandles = data.outputHandles ?? (data.hasOutput ? [{ id: "0" }] : []);
  const ports = {
    hasInput: inputHandles.length > 0,
    hasOutput: outputHandles.length > 0,
  };
  const multiChannel = outputHandles.length > 1 || inputHandles.length > 1;
  const previewOn = data.previewActive === true;
  const isRgb = data.rgbSwatch !== undefined;
  const isLed = data.ledColor !== undefined || isRgb;
  const isToggle = data.toggleWave !== undefined;
  const isTick = data.circular === true;
  const isBay = data.bay === true;
  // RGB is trigger-gated: off unless dry-run reports a driven intensity.
  // Never idle-animate color_cycle / breathe / blink — that looked "on" with no input.
  const ledColor = data.ledColor ?? data.rgbSwatch?.color ?? "#F5C518";
  const accent = data.accentColor ?? config.colorVar;
  const intensity =
    isLed && data.previewing
      ? (data.ledIntensity ?? (previewOn && !isRgb ? 1 : 0))
      : isRgb
        ? 0
        : undefined;
  const ledLit = intensity !== undefined && intensity > 0.08;
  const cardHeight = data.cardHeight;
  const cardWidth = data.cardWidth ?? NODE_WIDTH;

  const isRelay = data.tileGlyph === "power";
  const isIf = data.tileGlyph === "if";
  const ifBoolean = data.ifOutput?.kind === "boolean";
  const ifThenHigh = data.ifOutput?.thenHigh !== false;
  const ifLiveHigh = data.previewing ? previewOn : ifThenHigh;
  const ifOutColor = ifBoolean ? "#C026D3" : "#0F766E";
  const subtitle =
    isLed && data.previewing && intensity !== undefined
      ? intensity > 0.85
        ? "ON"
        : intensity < 0.15
          ? "OFF"
          : `${Math.round(intensity * 100)}%`
      : isRelay
        ? data.previewing
          ? previewOn
            ? copy.relayClosed
            : copy.relayOpen
          : ""
        : isIf
          ? data.subtitle
          : data.tempProbe
            ? `${Math.round(data.tempProbe.celsius)}°C`
            : data.subtitle;

  if (data.statusLed)
    return (
      <div className="signal-node-surface group relative rounded-xl border border-border-strong bg-surface shadow-e1"
        style={{ width: cardWidth, minHeight: cardHeight, outline: selected ? "2px solid var(--color-brand-blue)" : undefined }}>
        <BlockInfoButton label={data.label} help={data.help} />
        <HoverDeleteButton id={id} label={copy.deleteBlock} forceVisible={selected} />
        <div className="flex items-center gap-2 px-3 py-3 pr-8">
          <div className="h-8 w-8 shrink-0"><ModuleArtwork kind="led" name="LED interno" lightColor="#FFFFFF" /></div>
          <div className="min-w-0"><div className="font-body text-xs font-semibold text-ink">LED interno</div><div className="mt-1 font-body text-[10px] text-ink-muted">Intensità PWM · 0–100%</div></div>
        </div>
        <div className="border-t border-border py-1">
          {Array.from({length:Math.max(inputHandles.length,outputHandles.length)},(_,index)=>{
            const input=inputHandles[index], output=outputHandles[index];
            return <div key={index} className="relative grid h-8 grid-cols-2 items-center gap-6 px-3 font-body text-[10px] text-ink-muted">
              <span className="min-w-0 leading-snug">{input?.label}</span>
              <span className="min-w-0 text-right leading-snug">{output?.label}</span>
            </div>;
          })}
        </div>
        {inputHandles.map((handle,index)=><PortKindHandle key={handle.id} type="target" id={handle.id} title={handle.label} kind={handle.kind} top={INTERNAL_LED_FIRST_PORT_Y+index*INTERNAL_LED_PORT_SPACING} hitWidth={148} />)}
        {outputHandles.map((handle,index)=><PortKindHandle key={handle.id} type="source" id={handle.id} title={handle.label} kind={handle.kind} top={INTERNAL_LED_FIRST_PORT_Y+index*INTERNAL_LED_PORT_SPACING} hitWidth={148} />)}
      </div>
    );

  if (data.logicIf)
    return (
      <div className="signal-node-surface group relative rounded-xl border border-border-strong bg-surface shadow-e1"
        style={{ width: cardWidth, minHeight: cardHeight, outline: selected ? "2px solid var(--color-brand-blue)" : undefined }}>
        <BlockInfoButton label={data.label} help={data.help} />
        <HoverDeleteButton id={id} label={copy.deleteBlock} forceVisible={selected} />
        <div className="flex items-center gap-2 px-3 pt-2.5 pr-9">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "#F2EBFF", color: "#7C3AED" }}><GitBranch size={19} /></span>
          <span className="font-body text-sm font-semibold text-ink">{data.label}</span>
        </div>
        <div className="px-3 py-2.5 font-body text-xs font-medium leading-relaxed text-ink [overflow-wrap:anywhere]">{data.logicIf.condition}</div>
        <div className="grid grid-cols-2 gap-2 border-t border-border px-3 py-2">
          {[{ label: locale === "it" ? "Se vera" : "If true", value: data.logicIf.whenTrue }, { label: locale === "it" ? "Se falsa" : "If false", value: data.logicIf.whenFalse }].map(result => (
            <div key={result.label} className="flex items-center justify-between gap-2 rounded-md bg-surface-subtle px-2 py-1">
              <span className="font-body text-[10px] text-ink-muted">{result.label}</span>
              <span className="font-body text-xs font-semibold text-ink">{result.value}</span>
            </div>
          ))}
        </div>
        {inputHandles.map(handle => <PortKindHandle key={handle.id} type="target" id={handle.id} title={handle.label} kind={handle.kind} top={64} />)}
        {outputHandles.map(handle => <PortKindHandle key={handle.id} type="source" id={handle.id} title={handle.label} kind={handle.kind} top={64} />)}
      </div>
    );

  if (data.manualTrigger || data.signalGenerator)
    return (
      <div
        className="signal-node-surface group relative rounded-xl border border-border-strong bg-surface shadow-e1"
        style={{
          width: cardWidth,
          height: cardHeight,
          outline: selected ? "2px solid var(--color-brand-blue)" : undefined,
        }}
      >
        <BlockInfoButton label={data.label} help={data.help} right={data.sensorSchematic ? 22 : 8} />
        <HoverDeleteButton id={id} label="Elimina generatore" />
        {data.signalGenerator ? <SignalGeneratorControl config={data.signalGenerator} /> : <ManualTriggerControl
          nodeId={data.domainId}
          bindingId={data.manualTrigger?.bindingId}
        />}

        <Handle
          type="source"
          position={Position.Right}
          id={data.signalGenerator ? "0" : "trigger"}
          style={{
            ...SOURCE_HANDLE_STYLE,
            top: "50%",
            background: "var(--color-brand-blue)",
          }}
          aria-label="Avvia azione"
        />
      </div>
    );
  if (data.dataViewer)
    return (
      <div
        className="signal-node-surface group relative rounded-xl border border-border-strong bg-surface shadow-e1"
        style={{
          width: cardWidth,
          height: cardHeight,
          outline: selected ? "2px solid var(--color-brand-blue)" : undefined,
        }}
      >
        <BlockInfoButton label={data.label} help={data.help} right={data.sensorSchematic ? 22 : 8} />
        <HoverDeleteButton id={id} label="Elimina visualizzatore" />
        <Handle
          type="target"
          position={Position.Left}
          id="value"
          style={{
            ...SOURCE_HANDLE_STYLE,
            top: "50%",
            background: "var(--color-brand-blue)",
          }}
          aria-label="Mostra valore"
        />
        <DataViewerValue config={data.dataViewer} />
      </div>
    );
  if (isTick) {
    const fill = data.hasError
      ? "var(--color-error)"
      : (data.accentColor ?? FLOW_START_COLOR);
    return (
      <div
        className="group relative"
        style={{ width: FLOW_START_SIZE, height: FLOW_START_SIZE }}
      >
        <div
          className="signal-node-surface relative h-full w-full rounded-full shadow-e1 transition-[box-shadow,outline]"
          style={{
            backgroundColor: fill,
            outline: selected
              ? "2px solid var(--color-brand-blue)"
              : previewOn
                ? `2px solid color-mix(in srgb, ${fill} 70%, white)`
                : "1px solid color-mix(in srgb, #000 22%, transparent)",
            boxShadow: previewOn
              ? `0 0 0 4px color-mix(in srgb, ${fill} 35%, transparent), var(--shadow-e1)`
              : undefined,
            cursor: "default",
          }}
          title={copy.scheduleActivation}
        >
          <Handle
            type="source"
            position={Position.Right}
            id="0"
            style={{
              ...SOURCE_HANDLE_STYLE,
              width: 8,
              height: 8,
              borderRadius: "50%",
              right: -2,
              border: `1.5px solid ${fill}`,
              background: "var(--color-surface)",
            }}
          />
        </div>
      </div>
    );
  }

  const shellRadius = isBay ? "2px" : nodeShellRadius();
  const idleOutline = isBay
    ? `1.5px dashed color-mix(in srgb, ${BAY_EDGE} 75%, transparent)`
    : "1px solid var(--color-border)";
  const selectedOutline = selected
    ? "2px solid var(--color-brand-blue)"
    : ledLit
      ? `2px solid ${ledColor}`
      : undefined;

  if (data.sensorSchematic)
    return (
      <div
        className="group relative"
        style={{ width: cardWidth, height: cardHeight }}
        data-tour-target={`flow-node-${id}`}
      >
        <BlockInfoButton label={data.label} help={data.help} right={data.sensorSchematic ? 22 : 8} />
        <HoverDeleteButton
          id={id}
          label={copy.deleteBlock}
          forceVisible={selected}
          corner="right"
        />
        <div
          className="signal-node-surface absolute inset-x-4 inset-y-0 flex items-start gap-3 rounded-lg border bg-surface px-3 py-3 shadow-e1 transition-colors"
          style={{
            borderColor: selected ? "var(--color-brand-blue)" : "#cbd2dc",
            outline: selected ? "1px solid var(--color-brand-blue)" : undefined,
          }}
        >
          <div className="h-9 w-9 shrink-0" aria-hidden="true">
            <ModuleArtwork kind={data.hardwareKind ?? "generic"} name={data.label} />
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <strong
              className="block truncate font-heading text-xs text-ink"
              title={data.label}
            >
              {data.label}
            </strong>
            <span className="mt-1 block text-[10px] text-ink-muted">
              {data.hardwareSummary ??
                `${inputHandles.length} ${locale === "it" ? "ingressi" : "inputs"}${outputHandles.length ? ` · ${outputHandles.length} ${locale === "it" ? "uscite" : "outputs"}` : ""}`}
            </span>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-4 top-[54px] border-t border-border" />
        {[
          {
            type: "target" as const,
            position: Position.Left,
            handles: inputHandles,
            color: "#4e75df",
            side: "left" as const,
          },
          {
            type: "source" as const,
            position: Position.Right,
            handles: outputHandles,
            color: "#36976b",
            side: "right" as const,
          },
        ].map(({ type, position, handles, color, side }) =>
          handles.map((port, index) => (
            <div key={`${type}-${port.id}`}>
              {port.label &&
                !["esegui", "execute", "start"].includes(port.label.toLowerCase()) && (
                  <span
                    className="pointer-events-none absolute max-w-[124px] truncate font-body text-[9px] text-ink-muted"
                    style={{
                      [side]: 30,
                      textAlign: side === "right" ? "right" : "left",
                      top: 71 + index * 22,
                      transform: "translateY(-50%)",
                    }}
                  >
                    {port.label}
                  </span>
                )}
              <Handle
                type={type}
                position={position}
                id={port.id}
                aria-label={port.label ?? (type === "target" ? "Ingresso" : "Uscita")}
                title={port.label}
                style={{
                  ...SOURCE_HANDLE_STYLE,
                  [side]: 18,
                  top: 71 + index * 22,
                  width: 8,
                  height: 12,
                  borderRadius: 2,
                  border: "1.5px solid #454e5d",
                  background: "#f1f3f7",
                  boxShadow: `inset ${type === "target" ? "2px" : "-2px"} 0 0 ${color}`,
                }}
              />
            </div>
          )),
        )}
      </div>
    );

  if (data.tileGlyph === "sequence")
    return (
      <div
        className="group relative"
        style={{ width: cardWidth }}
        data-tour-target={`flow-node-${id}`}
      >
        <BlockInfoButton label={data.label} help={data.help} right={data.sensorSchematic ? 22 : 8} />
        <HoverDeleteButton
          id={id}
          label={copy.deleteBlock}
          forceVisible={selected}
          corner="right"
        />
        <div
          className="signal-node-surface relative rounded-lg bg-surface shadow-e1"
          style={{
            width: cardWidth,
            height: cardHeight,
            outline: data.hasError
              ? "2px solid var(--color-error)"
              : selected
                ? "2px solid var(--color-brand-blue)"
                : "1px solid var(--color-border-strong)",
          }}
        >
          <div className="flex h-[54px] items-center gap-2 border-b border-border px-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{
                color: accent,
                background: `color-mix(in srgb, ${accent} 10%, white)`,
              }}
            >
              <ListOrdered size={23} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">
                {data.label}
              </div>
              <div className="text-xs text-ink-muted">{subtitle}</div>
            </div>
          </div>
          {inputHandles.map((port, index) => (
            <div key={port.id}>
              <span
                className="pointer-events-none absolute left-3 text-[10px] text-ink-muted"
                style={{ top: 65 + index * 22, transform: "translateY(-50%)" }}
              >
                {port.label}
              </span>
              <PortKindHandle
                type="target"
                id={port.id}
                title={port.label}
                kind={port.kind}
                top={65 + index * 22}
              />
            </div>
          ))}
          {outputHandles.map((port, index) => (
            <div key={port.id}>
              <span
                className="pointer-events-none absolute right-5 text-[10px] text-ink-muted"
                style={{ top: 65 + index * 22, transform: "translateY(-50%)" }}
              >
                {port.label}
              </span>
              <PortKindHandle
                type="source"
                id={port.id}
                title={port.label}
                kind={port.kind}
                top={65 + index * 22}
              />
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <div
      className="group relative"
      style={{ width: cardWidth }}
      data-tour-target={`flow-node-${id}`}
    >
      <BlockInfoButton label={data.label} help={data.help} right={data.sensorSchematic ? 22 : 8} />
        <HoverDeleteButton
        id={id}
        label={copy.deleteBlock}
        forceVisible={selected}
        corner={multiChannel ? "left" : "right"}
      />
      {isBay && !multiChannel && (
        <span
          className="pointer-events-none absolute -top-2 right-1 z-10 inline-flex items-center gap-0.5 rounded-[3px] px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-wide"
          style={{
            color: BAY_EDGE,
            backgroundColor: "var(--color-surface)",
            outline: `1px solid color-mix(in srgb, ${BAY_EDGE} 45%, transparent)`,
          }}
          title={copy.bayModule}
        >
          <Cpu size={9} strokeWidth={2.5} aria-hidden />
          Bay
        </span>
      )}
      <div
        className={`signal-node-surface relative flex shadow-e1 transition-[outline,box-shadow] group-hover:shadow-e2 ${multiChannel ? "flex-col gap-1 px-2.5 py-2" : isIf || isRelay ? "w-full flex-col items-stretch p-0" : `w-full items-center gap-2 py-2 ${isLed ? "pl-4 pr-2.5" : "px-2.5"}`} ${selected || ledLit ? "" : "group-hover:outline-2"}`}
        style={{
          width: cardWidth,
          minHeight: cardHeight,
          borderRadius: shellRadius,
          backgroundColor: isBay
            ? `color-mix(in srgb, ${BAY_EDGE} 6%, var(--color-surface))`
            : "var(--color-surface)",
          outline: selectedOutline ?? idleOutline,
          // LED glow must not be clipped by the card / bay chrome.
          overflow: isLed || isIf || isRelay ? "visible" : undefined,
          boxShadow: ledLit
            ? `0 0 0 4px ${ledGlowRgba(ledColor, 0.12 + (intensity ?? 1) * 0.2)}, var(--shadow-e1)`
            : undefined,
        }}
      >
        {isBay && (
          <span
            className="absolute inset-y-1.5 left-0 w-0.5 rounded-full"
            style={{
              backgroundColor: `color-mix(in srgb, ${BAY_EDGE} 70%, transparent)`,
            }}
            aria-hidden
          />
        )}

        {!multiChannel &&
          inputHandles.map((handle, index) => (
            <PortKindHandle
              key={`in-${handle.id}`}
              type="target"
              id={handle.id}
              title={handle.label}
              kind={handle.kind}
              top={
                isIf || isRelay
                  ? NODE_HEIGHT / 2
                  : stackedHandleTop(index, inputHandles.length)
              }
            />
          ))}

        {/* No overflow-hidden on LED: tile box-shadow (glow) would get clipped on the left. */}
        <div
          className={`flex min-w-0 items-center gap-2 ${
            multiChannel
              ? "w-full flex-1 pr-1"
              : isLed
                ? ""
                : isIf || isRelay
                  ? "w-full"
                  : "flex-1 overflow-hidden"
          }`}
          style={
            isIf || isRelay
              ? {
                  minHeight: NODE_HEIGHT,
                  paddingLeft: isRelay ? 16 : 10,
                  paddingRight: 10,
                }
              : undefined
          }
        >
          <div
            className="h-10 w-10 shrink-0"
            aria-hidden
            style={{ filter: ledLit ? `drop-shadow(0 0 4px ${ledColor})` : undefined }}
          >
            {isLed || isRelay || data.tempProbe ? (
              <ModuleArtwork
                name={data.label}
                kind={isLed ? (isRgb ? "rgb" : "led") : isRelay ? "relay" : "sensor"}
                active={ledLit || (isRelay && previewOn)}
                lightColor={ledColor}
                intensity={intensity ?? 1}
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center rounded-lg"
                style={{
                  color: accent,
                  background: `color-mix(in srgb, ${accent} 10%, white)`,
                }}
              >
                {isToggle ? (
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <path
                      d="M3 20h5V8h8v12h5V8h4"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <Icon size={25} strokeWidth={1.8} />
                )}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 pr-5">
            <div className="flex min-w-0 items-center gap-1.5">
              <div
                className="min-w-0 whitespace-normal break-words font-body text-sm font-semibold text-ink"
                title={data.label}
              >
                {data.label}
              </div>
              {isBay && multiChannel && (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-[3px] px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-wide"
                  style={{
                    color: BAY_EDGE,
                    outline: `1px solid color-mix(in srgb, ${BAY_EDGE} 45%, transparent)`,
                  }}
                  title={copy.bayModule}
                >
                  <Cpu size={9} strokeWidth={2.5} aria-hidden />
                  Bay
                </span>
              )}
            </div>
            {subtitle ? (
              <div
                className={
                  isIf || isRelay
                    ? "whitespace-normal break-words [overflow-wrap:anywhere] font-mono text-[10px] leading-snug text-ink"
                    : "whitespace-normal break-words [overflow-wrap:anywhere] font-body text-xs leading-snug text-ink-faint"
                }
                title={
                  isIf
                    ? [subtitle, data.ifOutput?.thenElse].filter(Boolean).join(" · ")
                    : subtitle
                }
              >
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>
        {isIf && data.ifOutput && (
          <div
            className="grid grid-cols-2"
            style={{
              height: IF_FOOTER_HEIGHT,
              borderTop: `1px solid color-mix(in srgb, ${ifOutColor} 40%, var(--color-border))`,
              background: `color-mix(in srgb, ${ifOutColor} 8%, var(--color-surface))`,
            }}
          >
            <IfOutChip
              label={copy.ifThenTiny}
              value={
                ifBoolean
                  ? data.ifOutput.thenHigh
                    ? "true"
                    : "false"
                  : data.ifOutput.thenHigh
                    ? "HIGH"
                    : "LOW"
              }
              color={ifOutColor}
              active={data.ifOutput.thenHigh}
            />
            <IfOutChip
              label={copy.ifElseTiny}
              value={
                ifBoolean
                  ? data.ifOutput.elseHigh
                    ? "true"
                    : "false"
                  : data.ifOutput.elseHigh
                    ? "HIGH"
                    : "LOW"
              }
              color={ifOutColor}
              active={data.ifOutput.elseHigh}
              divided
            />
          </div>
        )}
        {isRelay && data.relayClose && (
          <div
            className="flex items-center justify-center"
            style={{
              height: IF_FOOTER_HEIGHT,
              borderTop:
                "1px solid color-mix(in srgb, #0F766E 40%, var(--color-border))",
              background: "color-mix(in srgb, #0F766E 8%, var(--color-surface))",
            }}
          >
            <IfOutChip
              label={copy.relayClosedIf}
              value={data.relayClose.closeWhenHigh ? "HIGH" : "LOW"}
              color="#0F766E"
              active
            />
          </div>
        )}

        {multiChannel ? (
          <div className="relative flex flex-col">
            {outputHandles.map((handle) => (
              <div
                key={`out-row-${handle.id}`}
                className="relative flex items-center justify-end gap-1.5 pr-3"
                style={{ height: CHANNEL_ROW_H }}
              >
                <span
                  className="min-w-0 truncate text-right font-mono text-[10px] font-medium text-ink-muted"
                  title={handle.label}
                >
                  {handle.label ?? handle.id}
                </span>
                <PortKindHandle
                  type="source"
                  id={handle.id}
                  title={handle.label}
                  kind={handle.kind}
                  top="50%"
                  extra={{ right: -2, transform: "translateY(-50%)" }}
                />
              </div>
            ))}
            {inputHandles.map((handle, index) => (
              <PortKindHandle
                key={`in-${handle.id}`}
                type="target"
                id={handle.id}
                title={handle.label}
                kind={handle.kind}
                top={stackedHandleTop(
                  index,
                  Math.max(inputHandles.length, outputHandles.length),
                )}
              />
            ))}
          </div>
        ) : (
          <>
            {outputHandles.map((handle, index) => (
              <PortKindHandle
                key={`out-${handle.id}`}
                type="source"
                id={handle.id}
                title={handle.label}
                kind={handle.kind}
                top={
                  isIf || isRelay
                    ? NODE_HEIGHT / 2
                    : stackedHandleTop(index, outputHandles.length)
                }
                live={isIf ? ifLiveHigh : previewOn}
              />
            ))}
            {isToggle && data.toggleWave && ports.hasOutput && (
              <ToggleOutputWaveform
                mode={data.toggleWave.mode}
                highTicks={data.toggleWave.highTicks}
                lowTicks={data.toggleWave.lowTicks}
                initialHigh={data.toggleWave.initialHigh}
                pulseMs={data.toggleWave.pulseMs}
                live={data.waveLive}
                lineHigh={previewOn}
                color={accent}
              />
            )}
          </>
        )}
      </div>
      {data.tempProbe && (
        <div
          className="nodrag nowheel nopan absolute left-0 right-0 top-full z-20 mt-1.5 px-0.5"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <input
            type="range"
            min={data.tempProbe.min}
            max={data.tempProbe.max}
            step={1}
            value={data.tempProbe.celsius}
            aria-label="Test temperature"
            onChange={(event) => data.tempProbe?.onChange?.(Number(event.target.value))}
            className="h-1.5 w-full cursor-ew-resize appearance-none rounded-full"
            style={{
              background: "linear-gradient(90deg, #38BDF8, #F97316)",
              accentColor: "#0EA5E9",
            }}
          />
          <div className="mt-0.5 text-center font-mono text-[10px] font-semibold text-ink-muted">
            {Math.round(data.tempProbe.celsius)}°C
          </div>
        </div>
      )}
    </div>
  );
}

const PORT_KIND_COLOR: Record<PortKind, string> = {
  digital: "#EA580C",
  analog: "#0EA5E9",
  boolean: "#C026D3",
  activation: "#4C2FB8",
  event: "#7C3AED",
  power: "#CA8A04",
};

const PORT_KIND_TITLE: Record<PortKind, string> = {
  digital: "Digital",
  analog: "Analog",
  boolean: "Boolean",
  activation: "Activation",
  event: "Event",
  power: "Power",
};

function PortKindHandle({
  type,
  id,
  title,
  kind,
  top,
  live,
  extra,
  hitWidth = 28,
}: {
  readonly type: "source" | "target";
  readonly id: string;
  readonly title?: string;
  readonly kind?: PortKind;
  readonly top: string | number;
  readonly live?: boolean;
  readonly extra?: CSSProperties;
  readonly hitWidth?: number;
}) {
  const color = kind ? PORT_KIND_COLOR[kind] : "var(--color-brand-blue)";
  const filled = live === true && type === "source";
  const kindTitle = kind ? PORT_KIND_TITLE[kind] : undefined;
  return (
    <Handle
      className="port-handle-hitarea"
      type={type}
      position={type === "target" ? Position.Left : Position.Right}
      id={id}
      title={[title, kindTitle].filter(Boolean).join(" · ") || undefined}
      style={{
        ...SOURCE_HANDLE_STYLE,
        "--port-hit-width": `${hitWidth}px`,
        top,
        border: `1.5px solid ${color}`,
        background: filled ? color : "var(--color-surface)",
        color: filled ? "#fff" : color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...extra,
      } as CSSProperties}
    >
      {kind ? (
        <span className="pointer-events-none flex">
          <PortKindGlyph kind={kind} />
        </span>
      ) : null}
    </Handle>
  );
}

function PortKindGlyph({ kind }: { readonly kind: PortKind }) {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
      {kind === "digital" ? (
        <path
          d="M1 6.5V2.5H3.2V6.5H5.4V2.5H8"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="miter"
        />
      ) : kind === "analog" ? (
        <path
          d="M1 5Q2.2 1.5 4.5 4.5T8 4"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      ) : kind === "boolean" ? (
        <path
          d="M4.5 1.4 7.4 4.5 4.5 7.6 1.6 4.5Z"
          stroke="currentColor"
          strokeWidth="1.15"
        />
      ) : kind === "activation" ? (
        <path d="M2.2 1.6v5.8L7.4 4.5Z" fill="currentColor" />
      ) : kind === "power" ? (
        <path d="M5.2 1.2 2.2 5.1h2.1L3.8 7.8 7 3.7H4.8Z" fill="currentColor" />
      ) : (
        <circle cx="4.5" cy="4.5" r="2.2" stroke="currentColor" strokeWidth="1.2" />
      )}
    </svg>
  );
}

function IfOutChip({
  label,
  value,
  color,
  active,
  divided,
}: {
  readonly label: string;
  readonly value: string;
  readonly color: string;
  readonly active: boolean;
  readonly divided?: boolean;
}) {
  return (
    <div
      className="flex min-w-0 items-center justify-center gap-1 whitespace-nowrap px-1"
      style={{
        borderLeft: divided
          ? `1px solid color-mix(in srgb, ${color} 35%, var(--color-border))`
          : undefined,
      }}
    >
      <span className="font-mono text-[8px] font-bold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <span
        className="font-mono text-[11px] font-semibold"
        style={{ color: active ? color : "var(--color-ink)" }}
      >
        {value}
      </span>
    </div>
  );
}

function ToggleOutputWaveform({
  mode,
  highTicks,
  lowTicks,
  initialHigh,
  pulseMs,
  live,
  lineHigh,
  color,
}: {
  readonly mode: ToggleMode;
  readonly highTicks: number;
  readonly lowTicks: number;
  readonly initialHigh: boolean;
  readonly pulseMs: number;
  readonly live: ProcessingNodeUiData["waveLive"];
  readonly lineHigh: boolean;
  readonly color: string;
}) {
  const w = live ? 52 : 34;
  const h = 16;
  const highY = 3;
  const lowY = 13;
  const path = live
    ? scrollingWavePath(
        live.elapsedMs,
        live.periodMs,
        mode,
        highTicks,
        lowTicks,
        initialHigh,
        pulseMs,
        w,
        highY,
        lowY,
      )
    : staticWavePath(mode, highTicks, lowTicks, initialHigh, pulseMs, w, highY, lowY);
  const stroke = live
    ? lineHigh
      ? color
      : "color-mix(in srgb, var(--color-ink-faint) 65%, transparent)"
    : color;
  const opacity = live ? 1 : 0.72;

  return (
    <span
      className="pointer-events-none absolute right-0 z-10 translate-x-[calc(100%+4px)] rounded-[3px] px-0.5 py-px"
      style={{
        bottom: "calc(50% + 10px)",
        backgroundColor: "color-mix(in srgb, var(--color-surface) 88%, transparent)",
        outline: `1px solid color-mix(in srgb, ${color} 28%, var(--color-border))`,
        boxShadow:
          live && lineHigh
            ? `0 0 0 2px color-mix(in srgb, ${color} 22%, transparent)`
            : undefined,
      }}
      aria-hidden
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={1.6}
          strokeLinejoin="miter"
          strokeLinecap="square"
          opacity={opacity}
        />
        {live && (
          <circle
            cx={w - 2.5}
            cy={lineHigh ? highY : lowY}
            r={1.7}
            fill={lineHigh ? color : "var(--color-ink-faint)"}
          />
        )}
      </svg>
    </span>
  );
}

function staticWavePath(
  mode: ToggleMode,
  highTicks: number,
  lowTicks: number,
  initialHigh: boolean,
  pulseMs: number,
  w: number,
  highY: number,
  lowY: number,
): string {
  if (mode === "pulse_high" || mode === "pulse_low") {
    const pulseFrac = Math.min(0.45, Math.max(0.12, pulseMs / 1000));
    const xPulse = Math.max(4, w * pulseFrac);
    if (mode === "pulse_high") {
      return `M 1 ${lowY} L 1 ${highY} L ${xPulse.toFixed(1)} ${highY} L ${xPulse.toFixed(1)} ${lowY} L ${(w - 1).toFixed(1)} ${lowY}`;
    }
    return `M 1 ${highY} L 1 ${lowY} L ${xPulse.toFixed(1)} ${lowY} L ${xPulse.toFixed(1)} ${highY} L ${(w - 1).toFixed(1)} ${highY}`;
  }
  const plateaus = waveformPlateaus(highTicks, lowTicks, initialHigh);
  const total = Math.max(1, highTicks + lowTicks);
  const padX = 1;
  const usable = w - padX * 2;
  let x = padX;
  const parts: string[] = [];
  let first = true;
  for (const plateau of plateaus) {
    const y = plateau.high ? highY : lowY;
    const segW = (plateau.ticks / total) * usable;
    if (first) {
      parts.push(`M ${x.toFixed(1)} ${y}`);
      first = false;
    } else {
      parts.push(`L ${x.toFixed(1)} ${y}`);
    }
    x += segW;
    parts.push(`L ${x.toFixed(1)} ${y}`);
  }
  return parts.join(" ");
}

function scrollingWavePath(
  elapsedMs: number,
  periodMs: number,
  mode: ToggleMode,
  highTicks: number,
  lowTicks: number,
  initialHigh: boolean,
  pulseMs: number,
  w: number,
  highY: number,
  lowY: number,
): string {
  const safePeriod = Math.max(1, periodMs);
  const cycleMs =
    mode === "astable" ? safePeriod * Math.max(1, highTicks + lowTicks) : safePeriod;
  const windowMs = Math.max(cycleMs * 2, safePeriod * 2);
  const samples = 48;
  const padX = 1;
  const usable = w - padX * 2;
  let d = "";
  let prevY: number | null = null;
  const channel = {
    triggerId: "",
    periodMs: safePeriod,
    highTicks,
    lowTicks,
    initialHigh,
    toggleMode: mode,
    pulseMs,
    actuators: [] as const,
    rgbActuators: [] as const,
    toggleIds: [] as const,
    startIds: [] as const,
  };
  for (let i = 0; i <= samples; i++) {
    const t = elapsedMs - windowMs + (i / samples) * windowMs;
    const x = padX + (i / samples) * usable;
    let high: boolean;
    if (t < 0) {
      high = mode === "pulse_low" ? true : mode === "pulse_high" ? false : initialHigh;
    } else if (mode === "astable") {
      high = lineHighAtTick(
        Math.floor(t / safePeriod),
        highTicks,
        lowTicks,
        initialHigh,
      );
    } else {
      high = lineHighAtElapsed(t, channel);
    }
    const y = high ? highY : lowY;
    if (prevY === null) {
      d = `M ${x.toFixed(2)} ${y}`;
    } else if (y !== prevY) {
      d += ` L ${x.toFixed(2)} ${prevY} L ${x.toFixed(2)} ${y}`;
    } else {
      d += ` L ${x.toFixed(2)} ${y}`;
    }
    prevY = y;
  }
  return d;
}

/** Dim an LED hex toward black by intensity (0–1), keeping the same hue. */
function ledGlowRgba(hex: string, alpha: number): string {
  const rgb = parseCssHex(hex);
  if (!rgb) return `rgba(245, 197, 24, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(1, Math.max(0, alpha))})`;
}

function parseCssHex(hex: string): { r: number; g: number; b: number } | undefined {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const PROCESSING_NODE_TYPES = { processing: ProcessingNode };

/** Every visual handle shares the wire palette, including compact hardware cards. */
function Handle(props: ComponentProps<typeof FlowHandle>) {
 const nodeId=useNodeId();
 const types=useStore(state => state.nodeLookup.get(nodeId ?? "")?.data.signalPortTypes) as ProcessingNodeUiData["signalPortTypes"];
 const matches=Object.entries(types ?? {}).filter(([key])=>key.startsWith(`${props.type}:`));
 const type=types?.[`${props.type}:${props.id ?? "0"}`] ?? (matches.length===1?matches[0]![1]:"any");
 const signal=SIGNAL_STYLES[type];
 const filled=props.style?.background!==undefined && props.style.background!=="var(--color-surface)";
 return <FlowHandle {...props} title={[props.title,signal.label].filter(Boolean).join(" · ")} style={{...props.style,borderColor:signal.color,background:filled?signal.color:"var(--color-surface)",color:filled?"#fff":signal.color,boxShadow:undefined}} />;
}
