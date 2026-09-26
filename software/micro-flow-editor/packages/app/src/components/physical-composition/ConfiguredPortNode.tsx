import type { Node, NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import { Cable } from "lucide-react";
import { useState, type ReactNode } from "react";
import { physicalCompositionCopy } from "../../lib/physical-composition-copy.js";
import { localizeCompositionLabel, physicalProtocolCopy } from "../../lib/physical-protocol-copy.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import { useLocale } from "../../state/locale-context.js";
import {
  PERIPHERAL_COLOR,
  PERIPHERAL_LABEL,
  assignedPeripheralKinds,
  assignedPinCount,
  compositionLines,
  fieldsForPeripheral,
  isLinePeripheral,
  isPowerPeripheral,
  pinCaption,
  pinColor,
  pinCompositionLines,
  pinLetter,
  pinPreviewSignal,
  type ConfiguredPortSummary,
  type LogicalPeripheral,
  type PinAssignment,
  type ProtocolField,
} from "../../lib/port-protocol-mock.js";

export const PORT_CARD_ID_PREFIX = "port-card-";
export const PORT_CARD_COLOR = "#0EA5A0";

export type ConfiguredPortNodeData = ConfiguredPortSummary & {
  readonly kind: "configured-port";
  readonly onPinClick?: (portId: number, pinIndex: number) => void;
};

export function portCardId(portId: number): string {
  return `${PORT_CARD_ID_PREFIX}${portId}`;
}

export function isPortCardId(id: string): boolean {
  return id.startsWith(PORT_CARD_ID_PREFIX);
}

export function portIdFromCardId(id: string): number {
  return Number(id.slice(PORT_CARD_ID_PREFIX.length));
}

export function ConfiguredPortNode({ data, selected }: NodeProps & { readonly data: ConfiguredPortNodeData }) {
  const { locale } = useLocale();
  const proto = physicalProtocolCopy(locale);
  const assigned = assignedPinCount({ portId: data.portId, pins: data.pins });
  const peripherals = assignedPeripheralKinds(data.pins);
  const namedPeripherals = peripherals.filter((peripheral) => !isPowerPeripheral(peripheral));
  const protocol = data.protocolName ?? data.nativeTypeId;
  const origin = data.fromCore ? proto.fromCore : assigned > 0 || protocol ? proto.configured : proto.byHand;
  const subtitle = [origin, proto.signals(data.pins.length), data.flowId !== undefined ? `Flow ${data.flowId}` : undefined, protocol].filter(Boolean).join(" · ");
  const [openPeripheral, setOpenPeripheral] = useState<LogicalPeripheral | null>(null);
  const [openFieldId, setOpenFieldId] = useState<string | null>(null);
  const [openPinIndex, setOpenPinIndex] = useState<number | null>(null);
  const quantities = openPeripheral ? fieldsForPeripheral(data.fields, openPeripheral, data.dialect) : [];
  const linePins = openPeripheral ? data.pins.filter((pin) => pin.peripheral === openPeripheral && isLinePeripheral(pin.peripheral)) : [];
  const openField = quantities.find((f) => f.id === openFieldId);
  const openPin = linePins.find((pin) => pin.pinIndex === openPinIndex);

  function togglePeripheral(peripheral: LogicalPeripheral) {
    if (openPeripheral === peripheral) {
      setOpenPeripheral(null);
      setOpenFieldId(null);
      return;
    }
    setOpenPeripheral(peripheral);
    setOpenFieldId(null);
    setOpenPinIndex(null);
  }

  return (
    <motion.div initial={{ opacity: 0, scale: 0.92, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={motionTokens.spring.bouncy} className="group">
      <div
        className={`w-72 overflow-hidden bg-surface shadow-e1 transition-[box-shadow,outline] group-hover:shadow-e2 ${selected ? "" : "outline outline-1 outline-[var(--color-border)]"}`}
        style={{
          borderRadius: "2px 2px 2px 20px",
          outline: selected ? "2px solid var(--color-brand-blue)" : undefined,
        }}
      >
        <div className="flex h-1.5 w-full">
          {(peripherals.length > 0 ? peripherals : ["unused" as const]).map((peripheral) => (
            <span key={peripheral} className="h-full flex-1" style={{ backgroundColor: peripheral === "unused" ? PORT_CARD_COLOR : PERIPHERAL_COLOR[peripheral] }} />
          ))}
        </div>
        <div className="flex items-start gap-2 px-3 pt-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-slsm" style={{ backgroundColor: PORT_CARD_COLOR }}>
            <Cable size={16} color="#fff" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="min-w-0 truncate font-body text-sm font-semibold text-ink">{physicalCompositionCopy(locale).portTitle(data.portId)}</div>
              <div className="flex shrink-0 items-center gap-1.5">
                {namedPeripherals.map((peripheral) => (
                  <PeripheralDot
                    key={peripheral}
                    peripheral={peripheral}
                    active={openPeripheral === peripheral}
                    onClick={() => togglePeripheral(peripheral)}
                  />
                ))}
              </div>
            </div>
            <div className="truncate font-body text-xs text-ink-faint">{subtitle}</div>
          </div>
        </div>

        <Reveal open={Boolean(openPeripheral)}>
          {openPeripheral && (
            <div className="px-3 pb-3 pt-2">
              <div className="mb-1.5 font-body text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                {physicalCompositionCopy(locale).quantity} · {PERIPHERAL_LABEL[openPeripheral]}
              </div>
              {linePins.length === 0 && quantities.length === 0 ? (
                <p className="font-body text-[11px] text-ink-faint">{physicalCompositionCopy(locale).noQuantity}</p>
              ) : linePins.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {linePins.map((pin) => (
                    <button
                      key={pin.pinIndex}
                      type="button"
                      className="nodrag nopan rounded-slpill px-2 py-0.5 font-body text-[10px] text-ink"
                      style={{
                        backgroundColor: openPinIndex === pin.pinIndex ? `color-mix(in srgb, ${PERIPHERAL_COLOR[openPeripheral]} 28%, transparent)` : `color-mix(in srgb, ${PORT_CARD_COLOR} 14%, transparent)`,
                        outline: openPinIndex === pin.pinIndex ? `1px solid ${PERIPHERAL_COLOR[openPeripheral]}` : undefined,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenPinIndex(openPinIndex === pin.pinIndex ? null : pin.pinIndex);
                        setOpenFieldId(null);
                      }}
                    >
                      {pinLetter(pin.pinIndex)} · {pin.label || pinPreviewSignal(pin)}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {quantities.map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      className="nodrag nopan rounded-slpill px-2 py-0.5 font-body text-[10px] text-ink"
                      style={{
                        backgroundColor: openFieldId === field.id ? `color-mix(in srgb, ${PERIPHERAL_COLOR[openPeripheral]} 28%, transparent)` : `color-mix(in srgb, ${PORT_CARD_COLOR} 14%, transparent)`,
                        outline: openFieldId === field.id ? `1px solid ${PERIPHERAL_COLOR[openPeripheral]}` : undefined,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenFieldId(openFieldId === field.id ? null : field.id);
                      }}
                    >
                      {field.label || field.name || field.identifier || proto.unnamed}
                    </button>
                  ))}
                </div>
              )}
              <Reveal open={Boolean(openField) || Boolean(openPin)}>
                {openField && <CompositionPanel field={openField} color={PERIPHERAL_COLOR[openPeripheral]} />}
                {openPin && <PinCompositionPanel pin={openPin} color={PERIPHERAL_COLOR[openPeripheral]} />}
              </Reveal>
            </div>
          )}
        </Reveal>

        <PinPreview pins={data.pins} onPinClick={(pinIndex) => data.onPinClick?.(data.portId, pinIndex)} />
      </div>
    </motion.div>
  );
}

function Reveal({ open, children }: { readonly open: boolean; readonly children: ReactNode }) {
  return (
    <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

function PinPreview({
  pins,
  onPinClick,
}: {
  readonly pins: readonly PinAssignment[];
  readonly onPinClick: (pinIndex: number) => void;
}) {
  return (
    <div className="mx-3 mb-3 mt-2 rounded-slmd bg-surface-sunken px-2.5 py-2">
      <div className="mb-1.5 font-body text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Pin</div>
      <div className="flex justify-center gap-2">
        {pins.map((pin) => {
          const color = pinColor(pin);
          const used = pin.peripheral !== "unused";
          const caption = used ? pinPreviewSignal(pin) : "·";
          return (
            <button
              key={pin.pinIndex}
              type="button"
              title={used ? `${pinLetter(pin.pinIndex)} · ${pinCaption(pin) || pin.signal}` : `${pinLetter(pin.pinIndex)} libero`}
              className="nodrag nopan flex flex-col items-center gap-0.5"
              onClick={(e) => {
                e.stopPropagation();
                onPinClick(pin.pinIndex);
              }}
            >
              <span
                className="block h-6 w-6 rounded-full"
                style={{
                  backgroundColor: color,
                  boxShadow: used ? `0 0 0 3px color-mix(in srgb, ${color} 28%, transparent)` : "0 0 0 1px var(--color-border-strong)",
                }}
              />
              <span className="font-mono text-[10px] text-ink-muted">{pinLetter(pin.pinIndex)}</span>
              <span className="h-3 max-w-8 truncate font-mono text-[9px]" style={{ color: used ? color : "transparent" }}>
                {caption}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PeripheralDot({
  peripheral,
  active,
  onClick,
}: {
  readonly peripheral: LogicalPeripheral;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  const color = PERIPHERAL_COLOR[peripheral];
  return (
    <button
      type="button"
      title={PERIPHERAL_LABEL[peripheral]}
      className="nodrag nopan flex items-center gap-1 rounded-slpill px-1 py-0.5 hover:bg-surface-sunken"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <span
        className="block h-3.5 w-3.5 rounded-full"
        style={{
          backgroundColor: color,
          boxShadow: active ? `0 0 0 3px color-mix(in srgb, ${color} 28%, transparent)` : undefined,
        }}
      />
      <span className="font-body text-[10px] font-semibold leading-none" style={{ color }}>
        {PERIPHERAL_LABEL[peripheral]}
      </span>
    </button>
  );
}

function PinCompositionPanel({ pin, color }: { readonly pin: PinAssignment; readonly color: string }) {
  const { locale } = useLocale();
  const lines = pinCompositionLines(pin);
  return (
    <div className="mt-2 rounded-slmd bg-surface-sunken px-2.5 py-2">
      <div className="mb-1 font-body text-[10px] font-semibold text-ink">{pinCaption(pin) || `${pinLetter(pin.pinIndex)}`}</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {lines.map((line) => (
          <div key={line.label} className="min-w-0">
            <span className="font-body text-[9px] uppercase tracking-wide text-ink-faint">{localizeCompositionLabel(line.label, locale)}</span>
            <div className="truncate font-mono text-[10px] text-ink" style={{ color }}>{line.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompositionPanel({ field, color }: { readonly field: ProtocolField; readonly color: string }) {
  const { locale } = useLocale();
  const lines = compositionLines(field);
  return (
    <div className="mt-2 rounded-slmd bg-surface-sunken px-2.5 py-2">
      <div className="mb-1 font-body text-[10px] font-semibold text-ink">{field.label || field.name}</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {lines.map((line) => (
          <div key={line.label} className="min-w-0">
            <span className="font-body text-[9px] uppercase tracking-wide text-ink-faint">{localizeCompositionLabel(line.label, locale)}</span>
            <div className="truncate font-mono text-[10px] text-ink" style={{ color }}>{line.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function toConfiguredPortNode(
  summary: ConfiguredPortSummary,
  index: number,
  existing?: Pick<Node<ConfiguredPortNodeData>, "position">,
  onPinClick?: (portId: number, pinIndex: number) => void,
): Node<ConfiguredPortNodeData> {
  return {
    id: portCardId(summary.portId),
    type: "configured-port",
    position: existing?.position ?? { x: 48, y: 40 + index * 228 },
    draggable: true,
    connectable: false,
    deletable: false,
    data: { ...summary, kind: "configured-port", onPinClick },
  };
}
