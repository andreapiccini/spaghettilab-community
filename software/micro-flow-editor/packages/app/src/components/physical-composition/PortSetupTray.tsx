import type { TopologyIndex } from "@spaghettilab/catalog-model";
import { ChevronLeft, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { motionTokens } from "../../lib/motion-tokens.js";
import {
  AUX_PERIPHERALS,
  DIALECT_LABEL,
  PERIPHERAL_LABEL,
  SIGNALS_FOR,
  PERIPHERAL_COLOR,
  applyExclusivePin,
  assignedPeripherals,
  assignedPinCount,
  compatibleDialects,
  declaredPortsOf,
  defaultDirectDialect,
  emptyLineSettings,
  emptyPin,
  emptyProtocol,
  exclusivePeripheralOf,
  hasConfigurablePins,
  INTEGRATED_MODULES,
  isDirectOnly,
  isExclusivePeripheral,
  isLinePeripheral,
  nextFreeSignal,
  nextOpenPinIndex,
  nextRequiredSignal,
  peripheralOfDialect,
  peripheralsFromCapabilities,
  pinCaption,
  pinColor,
  pinLetter,
  pinPreviewSignal,
  protocolFromIntegrated,
  protocolWithDialect,
  takenSignals,
  signalCountForPort,
  type CustomProtocol,
  type DeclaredPort,
  type DialectKind,
  type LogicalPeripheral,
  type PinAssignment,
  type PinLineSettings,
  type PortPinMap,
  type ProtocolMode,
} from "../../lib/port-protocol-mock.js";
import { usePortProtocol } from "../../state/port-protocol-context.js";
import { PinLineSettingsForm } from "./PinLineSettingsForm.js";
import { PortDialectPicker } from "./PortDialectPicker.js";
import { PortMappingEditor } from "./PortMappingEditor.js";
import type { PortSetupRequest } from "./port-setup-types.js";

const PERIPHERAL_ORDER: readonly LogicalPeripheral[] = ["uart", "i2c", "spi", "can", "gpio", "adc", "pwm", "dac", "w1", "vcc", "gnd", "unused"];

export function PortSetupTray({
  open,
  request,
  topology,
  extraPortIds = [],
  placedPortIds = [],
  topologyLoading = false,
  onReloadTopology,
  onClose,
}: {
  readonly open: boolean;
  readonly request: PortSetupRequest | null;
  readonly topology: TopologyIndex | null;
  readonly extraPortIds?: readonly number[];
  readonly placedPortIds?: readonly number[];
  readonly topologyLoading?: boolean;
  readonly onReloadTopology?: () => void;
  readonly onClose: () => void;
}) {
  const { pinMapOf, protocolFor, upsertProtocol, bindProtocol, savePort, capabilitiesOf } = usePortProtocol();
  const allDeclared = declaredPortsOf(topology, extraPortIds);
  const requestKey = !request ? "closed" : request.kind === "pick" ? "pick" : `${request.kind}-${request.portId}-${request.kind === "pin" ? (request.pinIndex ?? "") : ""}-${request.moduleNodeId ?? ""}`;
  const [wizard, setWizard] = useState<{ readonly key: string; readonly section: "pin" | "dialect" | "configure" }>({
    key: requestKey,
    section: request?.kind === "protocol" ? "dialect" : "pin",
  });
  const resetSection: "pin" | "dialect" | "configure" = request?.kind === "protocol" ? "dialect" : "pin";
  if (wizard.key !== requestKey) {
    setWizard({ key: requestKey, section: resetSection });
  }
  const section = wizard.key === requestKey ? wizard.section : resetSection;
  const setSection = (next: "pin" | "dialect" | "configure") => setWizard((prev) => ({ ...prev, section: next }));
  const portId = request && request.kind !== "pick" ? request.portId : -1;
  const moduleNodeId = request && request.kind !== "pick" ? request.moduleNodeId : undefined;
  const initialPin = request?.kind === "pin" ? request.pinIndex : undefined;
  const signalCount = portId >= 0 ? signalCountForPort(topology?.flows ?? [], portId) : 5;
  const peripherals = portId >= 0 ? assignedPeripherals(pinMapOf(portId, signalCount)) : [];
  const portCapabilities = portId >= 0 ? allDeclared.find((port) => port.portId === portId)?.capabilities ?? capabilitiesOf(portId) : undefined;
  const availableOnPort = peripheralsFromCapabilities(portCapabilities);
  const compatible = compatibleDialects(peripherals, availableOnPort);
  const current = portId >= 0 ? protocolFor({ moduleNodeId, portId }) : undefined;
  if (section === "dialect" && !hasConfigurablePins(peripherals)) {
    setSection("pin");
  }

  function placeAndClose(id: number) {
    savePort(id);
    onClose();
  }

  function commitBound(next: CustomProtocol) {
    upsertProtocol(next);
    bindProtocol(next.id, { moduleNodeId, portId });
  }

  function ensureCustom(dialect: DialectKind) {
    if (current) {
      commitBound({ ...protocolWithDialect(current, dialect), portId, moduleNodeId });
      return;
    }
    commitBound({ ...emptyProtocol(`proto-${portId}-${dialect}`, DIALECT_LABEL[dialect], dialect), portId, moduleNodeId });
  }

  function advanceFromPins() {
    if (!hasConfigurablePins(peripherals)) return;
    if (isDirectOnly(peripherals)) {
      const dialect = defaultDirectDialect(peripherals);
      if (dialect) ensureCustom(dialect);
      setSection("configure");
      return;
    }
    setSection("dialect");
  }

  function goBack() {
    if (section === "configure") {
      setSection(isDirectOnly(peripherals) ? "pin" : "dialect");
      return;
    }
    setSection("pin");
  }

  const title = !request || request.kind === "pick" ? "Aggiungi una Porta" : section === "dialect" ? `Porta ${portId} · protocollo` : section === "configure" ? `Porta ${portId} · mapping` : `Porta ${portId}`;

  return (
    <AnimatePresence>
      {open && request && (
        <motion.div initial={{ x: 360 }} animate={{ x: 0 }} exit={{ x: 360 }} transition={motionTokens.spring.smooth} className="flex h-full w-[360px] flex-col border-l border-border bg-surface shadow-e2">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            {request.kind !== "pick" && section !== "pin" && (
              <button type="button" onClick={goBack} className="flex h-8 w-8 items-center justify-center rounded-slsm text-ink-faint hover:bg-surface-raised" aria-label="Indietro">
                <ChevronLeft size={16} />
              </button>
            )}
            <h2 className="font-heading text-sm font-semibold text-ink">{title}</h2>
            <button type="button" onClick={onClose} className="ml-auto flex h-8 w-8 items-center justify-center rounded-slsm text-ink-faint hover:bg-surface-raised">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4">
            {request.kind === "pick" && (
              <PortPicker
                ports={allDeclared}
                placedPortIds={placedPortIds}
                loading={topologyLoading}
                onReload={onReloadTopology}
                onPick={placeAndClose}
              />
            )}
            {request.kind !== "pick" && portId >= 0 && section === "pin" && (
              <PinSignalEditor
                portId={portId}
                signalCount={signalCount}
                capabilities={portCapabilities}
                fromCore={allDeclared.find((port) => port.portId === portId)?.fromCore === true}
                initialPinIndex={initialPin}
                onAdvance={advanceFromPins}
                onReload={onReloadTopology}
                onDone={onClose}
              />
            )}
            {portId >= 0 && section === "dialect" && (
              <DialectStep
                peripherals={peripherals}
                compatible={compatible}
                currentDialect={current?.dialect && compatible.includes(current.dialect) ? current.dialect : undefined}
                currentModuleId={current?.integratedModuleId}
                onCustom={(dialect) => {
                  ensureCustom(dialect);
                }}
                onIntegrated={(moduleId) => {
                  const loaded = protocolFromIntegrated(moduleId, current?.id ?? `proto-${portId}-${moduleId}`);
                  if (loaded) commitBound({ ...loaded, portId, moduleNodeId });
                }}
                onNext={(mode) => {
                  if (mode === "integrated") {
                    savePort(portId);
                    onClose();
                    return;
                  }
                  setSection("configure");
                }}
              />
            )}
            {portId >= 0 && section === "configure" && current && (
              <PortMappingEditor
                protocol={current}
                onChange={(next) => commitBound({ ...next, portId, moduleNodeId })}
                onDone={() => {
                  savePort(portId);
                  onClose();
                }}
              />
            )}
            {portId >= 0 && section === "configure" && !current && (
              <p className="font-body text-sm text-ink-muted">Scegli prima un protocollo.</p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DialectStep({
  peripherals,
  compatible,
  currentDialect,
  currentModuleId,
  onCustom,
  onIntegrated,
  onNext,
}: {
  readonly peripherals: readonly LogicalPeripheral[];
  readonly compatible: readonly DialectKind[];
  readonly currentDialect?: DialectKind;
  readonly currentModuleId?: string;
  readonly onCustom: (dialect: DialectKind) => void;
  readonly onIntegrated: (moduleId: string) => void;
  readonly onNext: (mode: ProtocolMode) => void;
}) {
  const [mode, setMode] = useState<ProtocolMode>("integrated");
  const [dialect, setDialect] = useState<DialectKind | undefined>(currentDialect && compatible.includes(currentDialect) ? currentDialect : undefined);
  const [moduleId, setModuleId] = useState(() => {
    if (!currentModuleId) return undefined;
    return INTEGRATED_MODULES.some((mod) => mod.id === currentModuleId && compatible.includes(mod.dialect)) ? currentModuleId : undefined;
  });

  return (
    <PortDialectPicker
      peripherals={peripherals}
      compatible={compatible}
      mode={mode}
      dialect={dialect}
      integratedModuleId={moduleId}
      onMode={setMode}
      onDialect={(next) => {
        setDialect(next);
        onCustom(next);
      }}
      onIntegrated={(id) => {
        setModuleId(id);
        onIntegrated(id);
      }}
      onNext={() => onNext(mode)}
    />
  );
}

function portOptionLabel(port: DeclaredPort, placed: boolean): string {
  const bits = [`Porta ${port.portId}`];
  if (port.flowId !== undefined) bits.push(`Flow ${port.flowId}`);
  bits.push(`${port.signalCount} segnali`);
  if (placed) bits.push("già sul canvas");
  return bits.join(" · ");
}

function PortPicker({
  ports,
  placedPortIds,
  loading,
  onReload,
  onPick,
}: {
  readonly ports: readonly DeclaredPort[];
  readonly placedPortIds: readonly number[];
  readonly loading: boolean;
  readonly onReload?: () => void;
  readonly onPick: (portId: number) => void;
}) {
  const firstFree = ports.find((p) => !placedPortIds.includes(p.portId));
  const [chosen, setChosen] = useState(firstFree ? String(firstFree.portId) : "");

  if (loading && ports.length === 0) {
    return <p className="font-body text-sm text-ink-muted">Lettura Porte dal Core (GET_TOPOLOGY)…</p>;
  }

  if (ports.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-body text-sm text-ink">Nessuna Porta letta dal firmware. Il menu si riempie solo da GET_TOPOLOGY — non si digita un numero.</p>
        {onReload && (
          <button type="button" onClick={onReload} className="h-9 rounded-slsm bg-brand-blue font-body-strong text-sm text-white hover:bg-brand-blue-dark">
            Rileggi dal Core
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-sm text-ink-muted">Le Porte arrivano dal Core. Scegli dal menu, poi aggiungila al canvas.</p>
      <label className="block" htmlFor="port-from-core">
        <span className="mb-1 block font-body text-xs font-semibold text-ink-muted">Porta</span>
        <select
          id="port-from-core"
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
          className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-body text-sm outline-none"
        >
          <option value="">— scegli una Porta —</option>
          {ports.map((port) => {
            const placed = placedPortIds.includes(port.portId);
            return (
              <option key={port.portId} value={port.portId} disabled={placed}>
                {portOptionLabel(port, placed)}
              </option>
            );
          })}
        </select>
      </label>
      <button
        type="button"
        disabled={chosen === "" || placedPortIds.includes(Number(chosen))}
        onClick={() => onPick(Number(chosen))}
        className="h-9 rounded-slsm bg-brand-blue font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:opacity-40"
      >
        Aggiungi sul canvas
      </button>
      {onReload && (
        <button type="button" onClick={onReload} disabled={loading} className="h-9 rounded-slsm border border-border-strong font-body text-sm text-ink hover:bg-surface-raised disabled:opacity-40">
          {loading ? "Lettura…" : "Rileggi dal Core"}
        </button>
      )}
    </div>
  );
}

function PinSignalEditor({
  portId,
  signalCount,
  capabilities,
  fromCore,
  initialPinIndex,
  onAdvance,
  onReload,
  onDone,
}: {
  readonly portId: number;
  readonly signalCount: number;
  readonly capabilities?: number;
  readonly fromCore?: boolean;
  readonly initialPinIndex?: number;
  readonly onAdvance: () => void;
  readonly onReload?: () => void;
  readonly onDone: () => void;
}) {
  const { pinMapOf, setPinMap, protocolFor, upsertProtocol } = usePortProtocol();
  const map = pinMapOf(portId, signalCount);
  const [pinIndex, setPinIndex] = useState(initialPinIndex ?? map.pins[0]?.pinIndex ?? 1);
  const [pendingPeripheral, setPendingPeripheral] = useState<LogicalPeripheral | null>(null);
  const exclusive = exclusivePeripheralOf(assignedPeripherals(map));
  const [focus, setFocus] = useState<LogicalPeripheral | null>(exclusive ?? null);
  const pin = map.pins.find((p) => p.pinIndex === pinIndex) ?? map.pins[0];
  const assigned = assignedPinCount(map);
  const activePeripheral = focus ?? (pin && pin.peripheral !== "unused" ? pin.peripheral : null);
  const available = peripheralsFromCapabilities(capabilities);
  const offered = PERIPHERAL_ORDER.filter((key) => key === "unused" || available.includes(key));
  const offeredAux = AUX_PERIPHERALS.filter((key) => available.includes(key));
  const signals = activePeripheral && !isLinePeripheral(activePeripheral) ? SIGNALS_FOR[activePeripheral] : [];
  const usedSignals = activePeripheral ? takenSignals(map, activePeripheral, pin?.pinIndex) : [];

  function commitMap(nextMap: PortPinMap) {
    setPinMap(nextMap);
    const protocol = protocolFor({ portId });
    const nextExclusive = exclusivePeripheralOf(assignedPeripherals(nextMap));
    if (protocol && nextExclusive && peripheralOfDialect(protocol.dialect) !== nextExclusive) {
      upsertProtocol({ ...protocol, mode: "integrated", integratedModuleId: undefined, nativeTypeId: undefined, fields: [], groups: [] });
    }
  }

  function advanceAfter(nextMap: PortPinMap, fromPin: number, peripheral: LogicalPeripheral) {
    if (isLinePeripheral(peripheral)) {
      setPinIndex(fromPin);
      return;
    }
    const moreSignals = nextFreeSignal(nextMap, peripheral) !== "";
    const nextPin = moreSignals ? nextOpenPinIndex(nextMap, fromPin) : undefined;
    if (nextPin !== undefined) setPinIndex(nextPin);
    else setPinIndex(fromPin);
  }

  function assignmentFor(target: PinAssignment, peripheral: LogicalPeripheral, signal: string): PinAssignment {
    const settings = isLinePeripheral(peripheral) ? emptyLineSettings(peripheral, capabilities) : undefined;
    return {
      pinIndex: target.pinIndex,
      peripheral,
      signal,
      label: target.pinIndex === pin?.pinIndex ? target.label : "",
      ...(settings ? { settings } : {}),
    };
  }

  function assignOnPin(target: PinAssignment, peripheral: LogicalPeripheral, signal: string) {
    if (signal === "" && peripheral !== "unused") return;
    const nextMap = applyExclusivePin(map, assignmentFor(target, peripheral, signal));
    commitMap(nextMap);
    if (peripheral !== "unused") advanceAfter(nextMap, target.pinIndex, peripheral);
  }

  function choosePeripheral(key: LogicalPeripheral) {
    if (key === "unused") {
      if (!pin) return;
      commitMap(applyExclusivePin(map, emptyPin(pin.pinIndex)));
      setFocus(null);
      return;
    }
    if (isExclusivePeripheral(key) && exclusive && exclusive !== key) {
      setPendingPeripheral(key);
      return;
    }
    applyPeripheral(key);
  }

  function applyPeripheral(key: LogicalPeripheral) {
    setPendingPeripheral(null);
    setFocus(key);
    const signal = nextFreeSignal(map, key, pin?.peripheral === key ? pin.pinIndex : undefined);
    if (signal === "") return;
    const target =
      pin && (pin.peripheral === "unused" || pin.peripheral === key)
        ? pin
        : map.pins.find((p) => p.peripheral === "unused") ?? pin;
    if (!target) return;
    if (target.peripheral === key && target.signal !== "" && target.pinIndex === pin?.pinIndex) {
      if (isLinePeripheral(key)) return;
      const open = nextOpenPinIndex(map, target.pinIndex);
      const free = nextFreeSignal(map, key);
      if (open === undefined || free === "") return;
      const nextMap = applyExclusivePin(map, assignmentFor({ pinIndex: open, peripheral: "unused", signal: "", label: "" }, key, free));
      commitMap(nextMap);
      advanceAfter(nextMap, open, key);
      return;
    }
    assignOnPin(target, key, signal);
  }

  function applyAux(key: LogicalPeripheral) {
    setPendingPeripheral(null);
    setFocus(key);
    if (!pin) return;
    if (pin.peripheral === key && pin.signal !== "") return;
    const signal = nextFreeSignal(map, key, pin.peripheral === key ? pin.pinIndex : undefined);
    if (signal === "") return;
    assignOnPin(pin, key, signal);
  }

  function selectPin(index: number) {
    setPinIndex(index);
    const target = map.pins.find((p) => p.pinIndex === index);
    if (!target) return;
    if (target.peripheral !== "unused") {
      commitMap(applyExclusivePin(map, emptyPin(target.pinIndex)));
      return;
    }
    if (!focus) return;
    const free = isExclusivePeripheral(focus) ? nextRequiredSignal(map, focus) : nextFreeSignal(map, focus);
    if (free === "") return;
    assignOnPin(target, focus, free);
  }

  function chooseSignal(signal: string) {
    if (!pin || !activePeripheral) return;
    if (pin.peripheral === activePeripheral && pin.signal === signal) {
      commitMap(applyExclusivePin(map, { ...pin, peripheral: "unused", signal: "", label: "" }));
      return;
    }
    const holder = map.pins.find((p) => p.peripheral === activePeripheral && p.signal === signal);
    const freed = holder
      ? { portId: map.portId, pins: map.pins.map((p) => (p.pinIndex === holder.pinIndex ? emptyPin(p.pinIndex) : p)) }
      : map;
    const nextMap = applyExclusivePin(freed, assignmentFor({ ...pin, label: pin.label }, activePeripheral, signal));
    commitMap(nextMap);
    advanceAfter(nextMap, pin.pinIndex, activePeripheral);
  }

  function patchLabel(label: string) {
    if (!pin) return;
    commitMap(applyExclusivePin(map, { ...pin, label }));
  }

  function patchSettings(settings: PinLineSettings) {
    if (!pin) return;
    commitMap(applyExclusivePin(map, { ...pin, settings }));
  }

  if (!pin) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="font-body text-sm text-ink-muted">
        <p>
          {capabilities === undefined
            ? fromCore
              ? "Il Core ha questa Porta ma non ha inviato le periferiche del connettore. Aggiorna il firmware (GET_TOPOLOGY chiave 5) e rileggi. VCC e GND restano disponibili."
              : "Le periferiche MCU arrivano dal firmware di questa Porta. VCC e GND restano disponibili."
            : focus
              ? `Clicca un pin libero per assegnarlo, o un segnale già messo per toglierlo. ${signalCount} linee dal Core.`
              : `Scegli una periferica che il Core espone su questa Porta, poi assegna i segnali. ${signalCount} linee dal Core.`}
        </p>
        {capabilities !== undefined && (
          <p className="mt-1 font-body text-xs text-ink-faint">
            Su questa Porta: {available.filter((key) => key !== "vcc" && key !== "gnd").map((key) => PERIPHERAL_LABEL[key]).join(", ") || "nessuna periferica MCU"}
          </p>
        )}
        {capabilities === undefined && onReload && (
          <button type="button" onClick={onReload} className="mt-2 h-8 rounded-slsm border border-border-strong font-body text-xs text-ink hover:bg-surface-raised">
            Rileggi periferiche dal Core
          </button>
        )}
      </div>
      {pendingPeripheral && exclusive && (
        <div className="rounded-slmd border border-border bg-surface-sunken p-3">
          <p className="font-body text-sm text-ink">
            Hai già {PERIPHERAL_LABEL[exclusive]}. Passare a {PERIPHERAL_LABEL[pendingPeripheral]} toglie quei pin. Procedere?
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setPendingPeripheral(null)} className="h-8 flex-1 rounded-slsm border border-border-strong font-body text-xs text-ink hover:bg-surface-raised">
              Annulla
            </button>
            <button type="button" onClick={() => applyPeripheral(pendingPeripheral)} className="h-8 flex-1 rounded-slsm bg-brand-blue font-body-strong text-xs text-white hover:bg-brand-blue-dark">
              Procedi
            </button>
          </div>
        </div>
      )}

      <div className="rounded-slmd bg-surface-sunken p-3">
        <div className="mb-2 font-body text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Connettore</div>
        <div className="flex justify-center gap-2">
          {map.pins.map((p) => {
            const color = pinColor(p);
            const active = p.pinIndex === pin.pinIndex;
            const used = p.peripheral !== "unused";
            return (
              <button
                key={p.pinIndex}
                type="button"
                onClick={() => selectPin(p.pinIndex)}
                className="flex flex-col items-center gap-1"
                title={used ? `Togli ${p.signal || pinCaption(p)} da ${pinLetter(p.pinIndex)}` : pinLetter(p.pinIndex)}
              >
                <span
                  className="block h-7 w-7 rounded-full"
                  style={{
                    backgroundColor: color,
                    boxShadow: active ? `0 0 0 3px var(--color-brand-blue)` : used ? `0 0 0 3px color-mix(in srgb, ${color} 28%, transparent)` : "0 0 0 1px var(--color-border-strong)",
                  }}
                />
                <span className="font-mono text-[10px] text-ink-muted">{pinLetter(p.pinIndex)}</span>
                <span className="h-3 font-mono text-[9px]" style={{ color: used ? color : "transparent" }}>
                  {used ? pinPreviewSignal(p) : "·"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 font-body text-xs font-semibold text-ink-muted">Funzione — {pinLetter(pin.pinIndex)}</p>
        <div className="flex flex-wrap gap-1.5">
          {offered.map((key) => {
            const selected = focus === key || (!focus && pin.peripheral === key);
            const color = PERIPHERAL_COLOR[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => choosePeripheral(key)}
                className="rounded-slpill px-2.5 py-1 font-body text-xs"
                style={{
                  backgroundColor: selected ? color : "var(--color-surface-raised)",
                  color: selected ? "#fff" : "var(--color-ink)",
                  outline: selected ? undefined : "1px solid var(--color-border)",
                }}
              >
                {PERIPHERAL_LABEL[key]}
              </button>
            );
          })}
        </div>
        {offered.length <= 1 && (
          <p className="mt-2 font-body text-xs text-ink-faint">
            Nessuna periferica MCU disponibile su questa Porta. Rileggi le capacità dal Core o assegna VCC/GND.
          </p>
        )}
      </div>

      {focus && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="font-body text-xs font-semibold text-ink-muted">
              {PERIPHERAL_LABEL[focus]} — {pinLetter(pin.pinIndex)}
            </p>
            <button type="button" onClick={() => setFocus(null)} className="font-body text-xs text-brand-blue hover:underline">
              Chiudi dettaglio
            </button>
          </div>
          {exclusive && (
            <div>
              <p className="mb-1.5 font-body text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Altri pin — linee del Core</p>
              <div className="flex flex-wrap gap-1.5">
                {offeredAux.map((key) => {
                  const selected = pin.peripheral === key;
                  const color = PERIPHERAL_COLOR[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applyAux(key)}
                      className="rounded-slpill px-2.5 py-1 font-body text-xs"
                      style={{
                        backgroundColor: selected ? color : "var(--color-surface-raised)",
                        color: selected ? "#fff" : "var(--color-ink)",
                        outline: selected ? undefined : "1px solid var(--color-border)",
                      }}
                    >
                      {PERIPHERAL_LABEL[key]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {signals.length > 0 && (
        <div>
          <p className="mb-2 font-body text-xs font-semibold text-ink-muted">Segnale</p>
          <div className="flex flex-wrap gap-1.5">
            {signals.map((signal) => {
              const selected = pin.signal === signal;
              const taken = usedSignals.includes(signal);
              const holder = map.pins.find((p) => p.peripheral === activePeripheral && p.signal === signal);
              const color = pinColor({ pinIndex: pin.pinIndex, peripheral: activePeripheral ?? pin.peripheral, signal, label: "" });
              return (
                <button
                  key={signal}
                  type="button"
                  title={selected ? `Togli ${signal} da questo pin` : taken ? `${signal} su ${holder ? pinLetter(holder.pinIndex) : "?"} — clicca per spostarlo qui` : signal}
                  onClick={() => chooseSignal(signal)}
                  className="rounded-slpill px-3 py-1.5 font-mono text-xs"
                  style={{
                    backgroundColor: selected ? color : "var(--color-surface-raised)",
                    color: selected ? "#fff" : color,
                    outline: selected ? undefined : `1px solid ${color}`,
                    opacity: taken && !selected ? 0.55 : 1,
                  }}
                >
                  {signal}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(focus || pin.peripheral !== "unused") && (
        <label className="block">
          <span className="mb-1 block font-body text-xs font-semibold text-ink-muted">Nome (opzionale)</span>
          <input
            value={pin.label}
            placeholder={pinCaption(pin) || `${PERIPHERAL_LABEL[activePeripheral ?? pin.peripheral]}_${pin.signal || "…"}`}
            onChange={(e) => patchLabel(e.target.value)}
            className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none"
          />
        </label>
      )}

      {pin.settings && isLinePeripheral(pin.peripheral) && (
        <div>
          <p className="mb-2 font-body text-xs font-semibold text-ink-muted">Impostazioni {PERIPHERAL_LABEL[pin.peripheral]} · {pinLetter(pin.pinIndex)}</p>
          <PinLineSettingsForm settings={pin.settings} capabilities={capabilities} onChange={patchSettings} />
        </div>
      )}

      <p className="font-body text-xs text-ink-faint">
        {assigned === 0
          ? "Nessun segnale assegnato. Scegli una periferica del Core prima di andare al protocollo."
          : `${assigned} di ${signalCount} assegnati.`}
      </p>
      <button
        type="button"
        disabled={!hasConfigurablePins(assignedPeripherals(map))}
        onClick={onAdvance}
        className="h-9 rounded-slsm bg-brand-blue font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:opacity-40"
      >
        Avanti
      </button>
      <button type="button" onClick={onDone} className="h-9 rounded-slsm border border-border-strong font-body text-sm text-ink hover:bg-surface-raised">
        Solo pin, chiudi
      </button>
    </div>
  );
}
