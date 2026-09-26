import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { physicalCompositionCopy } from "../../lib/physical-composition-copy.js";
import { physicalProtocolCopy } from "../../lib/physical-protocol-copy.js";
import { useLocale } from "../../state/locale-context.js";
import {
  DIALECT_LABEL,
  applyFieldPatch,
  emptyField,
  mappingCaption,
  type AtSettings,
  type CanSettings,
  type CustomProtocol,
  type DialectSettings,
  type I2cSettings,
  type MappingAccess,
  type MappingDataType,
  type MappingSpec,
  type ModbusSettings,
  type ProtocolField,
  type SerialSettings,
  type SpiSettings,
  type W1Settings,
} from "../../lib/port-protocol-mock.js";

const ACCESS_OPTIONS: readonly { readonly value: MappingAccess; readonly label: string }[] = [
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
  { value: "read-write", label: "Read/Write" },
  { value: "event", label: "Event" },
];

const DATA_TYPES: readonly MappingDataType[] = ["int", "uint", "float", "bool", "string", "bytes"];

export function PortMappingEditor({
  protocol,
  onChange,
  onDone,
}: {
  readonly protocol: CustomProtocol;
  readonly onChange: (next: CustomProtocol) => void;
  readonly onDone: () => void;
}) {
  const { locale } = useLocale();
  const copy = physicalCompositionCopy(locale);
  const [openId, setOpenId] = useState<string | undefined>(protocol.fields[0]?.id);

  function commit(next: CustomProtocol) {
    onChange(next);
  }

  function patchSettings(settings: DialectSettings) {
    commit({ ...protocol, settings });
  }

  function patchField(id: string, patch: Parameters<typeof applyFieldPatch>[1]) {
    commit({ ...protocol, fields: protocol.fields.map((f) => (f.id === id ? applyFieldPatch(f, patch) : f)) });
  }

  function addMapping() {
    const field = emptyField(`${protocol.id}-f${protocol.fields.length + 1}`, protocol.dialect);
    commit({ ...protocol, fields: [...protocol.fields, field] });
    setOpenId(field.id);
  }

  function duplicateMapping(field: ProtocolField) {
    let n = 1;
    let id = `${field.id}-copy`;
    while (protocol.fields.some((f) => f.id === id)) {
      n += 1;
      id = `${field.id}-copy${n}`;
    }
    const copy = applyFieldPatch(
      { ...field, id },
      { label: field.label ? `${field.label} copia` : "", identifier: field.identifier ? `${field.identifier}_copy` : "" },
    );
    const i = protocol.fields.findIndex((f) => f.id === field.id);
    const fields = [...protocol.fields];
    fields.splice(i + 1, 0, copy);
    commit({ ...protocol, fields });
    setOpenId(copy.id);
  }

  return (
    <div className="flex flex-col gap-4">
      <section>
        <p className="mb-2 font-body text-xs font-semibold uppercase tracking-wide text-ink-faint">{physicalProtocolCopy(locale).interfacePrefix} · {DIALECT_LABEL[protocol.dialect]}</p>
        {protocol.mode === "integrated" && (
          <p className="mb-2 font-body text-xs text-ink-muted">{protocol.name} — {physicalProtocolCopy(locale).prefilled}</p>
        )}
        <SettingsForm settings={protocol.settings} onChange={patchSettings} />
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <p className="font-body text-xs font-semibold uppercase tracking-wide text-ink-faint">Mapping</p>
          <button type="button" onClick={addMapping} className="flex items-center gap-1 font-body text-xs text-brand-blue hover:underline">
            <Plus size={12} /> {physicalProtocolCopy(locale).addMapping}
          </button>
        </div>

        {protocol.fields.length === 0 && (
          <p className="mb-2 font-body text-xs text-ink-faint">{copy.noMapping}</p>
        )}

        <div className="flex flex-col gap-2">
          {protocol.fields.map((field) => (
            <MappingCard
              key={field.id}
              field={field}
              open={openId === field.id}
              onToggle={() => setOpenId(openId === field.id ? undefined : field.id)}
              onChange={(patch) => patchField(field.id, patch)}
              onDuplicate={() => duplicateMapping(field)}
              onRemove={() => commit({ ...protocol, fields: protocol.fields.filter((f) => f.id !== field.id) })}
            />
          ))}
        </div>
      </section>

      <button type="button" onClick={onDone} className="h-9 rounded-slsm bg-brand-blue font-body-strong text-sm text-white hover:bg-brand-blue-dark">
        {copy.saveAndClose}
      </button>
    </div>
  );
}

function MappingCard({
  field,
  open,
  onToggle,
  onChange,
  onDuplicate,
  onRemove,
}: {
  readonly field: ProtocolField;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onChange: (patch: Parameters<typeof applyFieldPatch>[1]) => void;
  readonly onDuplicate: () => void;
  readonly onRemove: () => void;
}) {
  const { locale } = useLocale();
  const copy = physicalCompositionCopy(locale);
  const proto = physicalProtocolCopy(locale);
  return (
    <div className={`rounded-slmd border ${open ? "border-brand-blue" : "border-border"}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <span className="block truncate font-body text-xs font-semibold text-ink">{field.label || field.identifier || proto.unnamed}</span>
          <span className="block truncate font-mono text-[10px] text-ink-faint">
            {field.access} · {field.dataType} · {mappingCaption(field)}
          </span>
        </button>
        <IconBtn label={proto.edit} onClick={onToggle}>
          <Pencil size={12} />
        </IconBtn>
        <IconBtn label={proto.duplicate} onClick={onDuplicate}>
          <Copy size={12} />
        </IconBtn>
        <IconBtn label={proto.remove} onClick={onRemove} danger>
          <Trash2 size={12} />
        </IconBtn>
      </div>
      {open && (
        <div className="border-t border-border px-2 py-2">
          <FormGrid>
            <Text label="Label" value={field.label} onChange={(label) => onChange({ label })} />
            <Text label={proto.identifier} value={field.identifier} onChange={(identifier) => onChange({ identifier })} mono />
            <Select label={proto.access} value={field.access} options={ACCESS_OPTIONS} onChange={(access) => onChange({ access: access as MappingAccess })} />
            <Select label={proto.dataType} value={field.dataType} options={DATA_TYPES.map((v) => ({ value: v, label: v }))} onChange={(dataType) => onChange({ dataType: dataType as MappingDataType })} />
            <Text label={proto.scale} value={field.scale} onChange={(scale) => onChange({ scale })} />
            <Text label={proto.offset} value={field.offset} onChange={(offset) => onChange({ offset })} />
            <Text label={copy.unit} value={field.unit} onChange={(unit) => onChange({ unit })} />
            <Text label={proto.updateHz} value={field.updateHz} onChange={(updateHz) => onChange({ updateHz })} />
          </FormGrid>
          <div className="mt-2">
            <SpecForm spec={field.spec} onChange={(spec) => onChange({ spec })} />
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsForm({ settings, onChange }: { readonly settings: DialectSettings; readonly onChange: (next: DialectSettings) => void }) {
  const { locale } = useLocale();
  const copy = physicalCompositionCopy(locale);
  switch (settings.kind) {
    case "gpio":
      return <p className="font-body text-xs text-ink-faint">{copy.noBusSettings}</p>;
    case "adc":
      return (
        <FormGrid>
          <Text label={physicalProtocolCopy(useLocale().locale).resolutionBits} value={settings.resolution} onChange={(resolution) => onChange({ ...settings, resolution })} />
          <Text label="Range min" value={settings.rangeMin} onChange={(rangeMin) => onChange({ ...settings, rangeMin })} />
          <Text label="Range max" value={settings.rangeMax} onChange={(rangeMax) => onChange({ ...settings, rangeMax })} wide />
        </FormGrid>
      );
    case "pwm":
      return (
        <FormGrid>
          <Text label={physicalProtocolCopy(useLocale().locale).frequencyHz} value={settings.frequencyHz} onChange={(frequencyHz) => onChange({ ...settings, frequencyHz })} wide />
        </FormGrid>
      );
    case "dac":
      return (
        <FormGrid>
          <Text label={physicalProtocolCopy(useLocale().locale).resolutionBits} value={settings.resolution} onChange={(resolution) => onChange({ ...settings, resolution })} />
          <Text label="Range min" value={settings.rangeMin} onChange={(rangeMin) => onChange({ ...settings, rangeMin })} />
          <Text label="Range max" value={settings.rangeMax} onChange={(rangeMax) => onChange({ ...settings, rangeMax })} wide />
        </FormGrid>
      );
    case "i2c":
      return <I2cSettingsForm settings={settings} onChange={onChange} />;
    case "spi":
      return <SpiSettingsForm settings={settings} onChange={onChange} />;
    case "uart":
    case "raw-serial":
      return <SerialSettingsForm settings={settings} onChange={(next) => onChange({ ...next, kind: settings.kind })} />;
    case "at":
      return <AtSettingsForm settings={settings} onChange={onChange} />;
    case "modbus-rtu":
      return <ModbusSettingsForm settings={settings} onChange={onChange} />;
    case "can":
      return <CanSettingsForm settings={settings} onChange={onChange} />;
    case "w1":
      return <W1SettingsForm settings={settings} onChange={onChange} />;
  }
}

function I2cSettingsForm({ settings, onChange }: { readonly settings: { readonly kind: "i2c" } & I2cSettings; readonly onChange: (next: DialectSettings) => void }) {
  return (
    <FormGrid>
      <Text label={physicalProtocolCopy(useLocale().locale).deviceAddress} value={settings.address} onChange={(address) => onChange({ ...settings, address })} mono />
      <Text label={physicalProtocolCopy(useLocale().locale).busFrequencyHz} value={settings.busHz} onChange={(busHz) => onChange({ ...settings, busHz })} />
      <Select label={physicalProtocolCopy(useLocale().locale).registerWidth} value={settings.registerWidth} options={[{ value: "8", label: "8 bit" }, { value: "16", label: "16 bit" }]} onChange={(registerWidth) => onChange({ ...settings, registerWidth: registerWidth as "8" | "16" })} />
      <Text label={physicalProtocolCopy(useLocale().locale).timeoutMs} value={settings.timeoutMs} onChange={(timeoutMs) => onChange({ ...settings, timeoutMs })} />
    </FormGrid>
  );
}

function SpiSettingsForm({ settings, onChange }: { readonly settings: { readonly kind: "spi" } & SpiSettings; readonly onChange: (next: DialectSettings) => void }) {
  return (
    <FormGrid>
      <Text label="Chip Select" value={settings.chipSelect} onChange={(chipSelect) => onChange({ ...settings, chipSelect })} />
      <Select label="SPI mode" value={settings.mode} options={["0", "1", "2", "3"].map((v) => ({ value: v, label: `Mode ${v}` }))} onChange={(mode) => onChange({ ...settings, mode: mode as SpiSettings["mode"] })} />
      <Text label={physicalProtocolCopy(useLocale().locale).frequencyHz} value={settings.frequencyHz} onChange={(frequencyHz) => onChange({ ...settings, frequencyHz })} />
      <Select label="Bit order" value={settings.bitOrder} options={[{ value: "msb", label: "MSB" }, { value: "lsb", label: "LSB" }]} onChange={(bitOrder) => onChange({ ...settings, bitOrder: bitOrder as "msb" | "lsb" })} />
      <Text label="Read/Write mask" value={settings.rwMask} onChange={(rwMask) => onChange({ ...settings, rwMask })} mono />
      <Text label="Auto-increment mask" value={settings.autoIncrementMask} onChange={(autoIncrementMask) => onChange({ ...settings, autoIncrementMask })} mono />
      <Text label="Dummy bytes" value={settings.dummyBytes} onChange={(dummyBytes) => onChange({ ...settings, dummyBytes })} />
      <Select label="Chip Select" value={settings.csMode} options={[{ value: "auto", label: physicalProtocolCopy(useLocale().locale).automatic }, { value: "manual", label: physicalProtocolCopy(useLocale().locale).manual }]} onChange={(csMode) => onChange({ ...settings, csMode: csMode as "auto" | "manual" })} />
    </FormGrid>
  );
}

function SerialSettingsForm({ settings, onChange }: { readonly settings: SerialSettings; readonly onChange: (next: SerialSettings) => void }) {
  return (
    <FormGrid>
      <Text label="Baud rate" value={settings.baud} onChange={(baud) => onChange({ ...settings, baud })} />
      <Select label="Data bits" value={settings.dataBits} options={[{ value: "7", label: "7" }, { value: "8", label: "8" }]} onChange={(dataBits) => onChange({ ...settings, dataBits: dataBits as "7" | "8" })} />
      <Select label={physicalCompositionCopy(useLocale().locale).parity} value={settings.parity} options={[{ value: "none", label: "None" }, { value: "even", label: "Even" }, { value: "odd", label: "Odd" }]} onChange={(parity) => onChange({ ...settings, parity: parity as SerialSettings["parity"] })} />
      <Select label="Stop bits" value={settings.stopBits} options={[{ value: "1", label: "1" }, { value: "2", label: "2" }]} onChange={(stopBits) => onChange({ ...settings, stopBits: stopBits as "1" | "2" })} />
      <Select label="Flow control" value={settings.flowControl} options={[{ value: "none", label: physicalProtocolCopy(useLocale().locale).none }, { value: "rts-cts", label: "RTS/CTS" }]} onChange={(flowControl) => onChange({ ...settings, flowControl: flowControl as "none" | "rts-cts" })} />
      <Text label="Timeout (ms)" value={settings.timeoutMs} onChange={(timeoutMs) => onChange({ ...settings, timeoutMs })} />
      <Select
        label={physicalProtocolCopy(useLocale().locale).frameFormat}
        value={settings.frameFormat}
        options={[
          { value: "terminator", label: physicalProtocolCopy(useLocale().locale).terminator },
          { value: "fixed", label: physicalProtocolCopy(useLocale().locale).fixedLength },
          { value: "csv", label: "CSV" },
          { value: "json", label: "JSON" },
          { value: "regex", label: "Regex" },
          { value: "binary", label: physicalProtocolCopy(useLocale().locale).binary },
        ]}
        onChange={(frameFormat) => onChange({ ...settings, frameFormat: frameFormat as SerialSettings["frameFormat"] })}
      />
      {settings.frameFormat === "terminator" && <Text label={physicalProtocolCopy(useLocale().locale).terminator} value={settings.terminator} onChange={(terminator) => onChange({ ...settings, terminator })} mono />}
      {settings.frameFormat === "fixed" && <Text label={physicalProtocolCopy(useLocale().locale).frameLength} value={settings.frameLength} onChange={(frameLength) => onChange({ ...settings, frameLength })} />}
    </FormGrid>
  );
}

function AtSettingsForm({ settings, onChange }: { readonly settings: { readonly kind: "at" } & AtSettings; readonly onChange: (next: DialectSettings) => void }) {
  return (
    <FormGrid>
      <Text label="Baud rate" value={settings.baud} onChange={(baud) => onChange({ ...settings, baud })} />
      <Select label="Data bits" value={settings.dataBits} options={[{ value: "7", label: "7" }, { value: "8", label: "8" }]} onChange={(dataBits) => onChange({ ...settings, dataBits: dataBits as "7" | "8" })} />
      <Select label={physicalCompositionCopy(useLocale().locale).parity} value={settings.parity} options={[{ value: "none", label: "None" }, { value: "even", label: "Even" }, { value: "odd", label: "Odd" }]} onChange={(parity) => onChange({ ...settings, parity: parity as AtSettings["parity"] })} />
      <Select label="Stop bits" value={settings.stopBits} options={[{ value: "1", label: "1" }, { value: "2", label: "2" }]} onChange={(stopBits) => onChange({ ...settings, stopBits: stopBits as "1" | "2" })} />
      <Select label="Flow control" value={settings.flowControl} options={[{ value: "none", label: physicalProtocolCopy(useLocale().locale).none }, { value: "rts-cts", label: "RTS/CTS" }]} onChange={(flowControl) => onChange({ ...settings, flowControl: flowControl as "none" | "rts-cts" })} />
      <Text label={physicalProtocolCopy(useLocale().locale).terminator} value={settings.terminator} onChange={(terminator) => onChange({ ...settings, terminator })} mono />
      <Text label="Timeout (ms)" value={settings.timeoutMs} onChange={(timeoutMs) => onChange({ ...settings, timeoutMs })} />
      <Text label="Token OK" value={settings.okToken} onChange={(okToken) => onChange({ ...settings, okToken })} mono />
      <Text label="Token ERROR" value={settings.errorToken} onChange={(errorToken) => onChange({ ...settings, errorToken })} mono />
      <Select label="Echo" value={settings.echo ? "1" : "0"} options={[{ value: "1", label: physicalProtocolCopy(useLocale().locale).on }, { value: "0", label: physicalProtocolCopy(useLocale().locale).off }]} onChange={(echo) => onChange({ ...settings, echo: echo === "1" })} />
      <Select label={physicalProtocolCopy(useLocale().locale).asyncUrc} value={settings.urc ? "1" : "0"} options={[{ value: "1", label: physicalProtocolCopy(useLocale().locale).handled }, { value: "0", label: physicalProtocolCopy(useLocale().locale).ignored }]} onChange={(urc) => onChange({ ...settings, urc: urc === "1" })} />
    </FormGrid>
  );
}

function ModbusSettingsForm({ settings, onChange }: { readonly settings: { readonly kind: "modbus-rtu" } & ModbusSettings; readonly onChange: (next: DialectSettings) => void }) {
  return (
    <FormGrid>
      <Text label="Baud rate" value={settings.baud} onChange={(baud) => onChange({ ...settings, baud })} />
      <Select label="Data bits" value={settings.dataBits} options={[{ value: "7", label: "7" }, { value: "8", label: "8" }]} onChange={(dataBits) => onChange({ ...settings, dataBits: dataBits as "7" | "8" })} />
      <Select label={physicalCompositionCopy(useLocale().locale).parity} value={settings.parity} options={[{ value: "none", label: "None" }, { value: "even", label: "Even" }, { value: "odd", label: "Odd" }]} onChange={(parity) => onChange({ ...settings, parity: parity as ModbusSettings["parity"] })} />
      <Select label="Stop bits" value={settings.stopBits} options={[{ value: "1", label: "1" }, { value: "2", label: "2" }]} onChange={(stopBits) => onChange({ ...settings, stopBits: stopBits as "1" | "2" })} />
      <Select label="RS485" value={settings.rs485 ? "1" : "0"} options={[{ value: "1", label: physicalCompositionCopy(useLocale().locale).yes }, { value: "0", label: "UART" }]} onChange={(rs485) => onChange({ ...settings, rs485: rs485 === "1" })} />
      <Text label="Slave ID" value={settings.slaveId} onChange={(slaveId) => onChange({ ...settings, slaveId })} />
      <Text label="Timeout (ms)" value={settings.timeoutMs} onChange={(timeoutMs) => onChange({ ...settings, timeoutMs })} />
      <Text label="Retry" value={settings.retries} onChange={(retries) => onChange({ ...settings, retries })} />
      <Text label={physicalProtocolCopy(useLocale().locale).requestGapMs} value={settings.gapMs} onChange={(gapMs) => onChange({ ...settings, gapMs })} />
      <Select label={physicalProtocolCopy(useLocale().locale).addressing} value={settings.addressing} options={[{ value: "zero", label: "Zero-based" }, { value: "doc", label: physicalProtocolCopy(useLocale().locale).addressingDoc }]} onChange={(addressing) => onChange({ ...settings, addressing: addressing as "zero" | "doc" })} />
    </FormGrid>
  );
}

function CanSettingsForm({ settings, onChange }: { readonly settings: { readonly kind: "can" } & CanSettings; readonly onChange: (next: DialectSettings) => void }) {
  return (
    <FormGrid>
      <Text label="Bitrate" value={settings.bitrate} onChange={(bitrate) => onChange({ ...settings, bitrate })} />
      <Select label="Frame" value={settings.frame} options={[{ value: "standard", label: "Standard" }, { value: "extended", label: "Extended" }]} onChange={(frame) => onChange({ ...settings, frame: frame as "standard" | "extended" })} />
      <Text label={physicalProtocolCopy(useLocale().locale).filters} value={settings.filters} onChange={(filters) => onChange({ ...settings, filters })} wide />
      <Select label={physicalCompositionCopy(useLocale().locale).mode} value={settings.mode} options={[{ value: "raw", label: "Raw" }, { value: "dbc", label: "DBC" }]} onChange={(mode) => onChange({ ...settings, mode: mode as "raw" | "dbc" })} />
    </FormGrid>
  );
}

function W1SettingsForm({ settings, onChange }: { readonly settings: { readonly kind: "w1" } & W1Settings; readonly onChange: (next: DialectSettings) => void }) {
  return (
    <FormGrid>
      <Text label="ROM address" value={settings.rom} onChange={(rom) => onChange({ ...settings, rom })} mono />
      <Text label="Family code" value={settings.family} onChange={(family) => onChange({ ...settings, family })} mono />
      <Text label="Timeout (ms)" value={settings.timeoutMs} onChange={(timeoutMs) => onChange({ ...settings, timeoutMs })} wide />
    </FormGrid>
  );
}

function SpecForm({ spec, onChange }: { readonly spec: MappingSpec; readonly onChange: (patch: Partial<MappingSpec>) => void }) {
  const { locale } = useLocale();
  const copy = physicalCompositionCopy(locale);
  const proto = physicalProtocolCopy(locale);
  switch (spec.kind) {
    case "gpio":
      return (
        <FormGrid>
          <Select label={proto.direction} value={spec.direction} options={[{ value: "input", label: "Input" }, { value: "output", label: "Output" }]} onChange={(direction) => onChange({ direction: direction as "input" | "output" })} />
          <Select label={copy.polarity} value={spec.polarity} options={[{ value: "high", label: "Active high" }, { value: "low", label: "Active low" }]} onChange={(polarity) => onChange({ polarity: polarity as "high" | "low" })} />
          <Select label="Pull" value={spec.pull} options={[{ value: "none", label: proto.none }, { value: "up", label: "Pull-up" }, { value: "down", label: "Pull-down" }]} onChange={(pull) => onChange({ pull: pull as "none" | "up" | "down" })} />
          <Text label={proto.debounceMs} value={spec.debounceMs} onChange={(debounceMs) => onChange({ debounceMs })} />
          <Select label="Edge trigger" value={spec.edge} options={[{ value: "none", label: proto.none }, { value: "rising", label: "Rising" }, { value: "falling", label: "Falling" }, { value: "both", label: "Both" }]} onChange={(edge) => onChange({ edge: edge as "none" | "rising" | "falling" | "both" })} />
          {spec.direction === "output" && <Text label={proto.initialValue} value={spec.initial} onChange={(initial) => onChange({ initial })} />}
          {spec.direction === "output" && <Text label="Safe state" value={spec.safeState} onChange={(safeState) => onChange({ safeState })} />}
        </FormGrid>
      );
    case "adc":
      return (
        <FormGrid>
          <Text label={proto.rawMin} value={spec.rawMin} onChange={(rawMin) => onChange({ rawMin })} />
          <Text label={proto.rawMax} value={spec.rawMax} onChange={(rawMax) => onChange({ rawMax })} />
          <Text label={proto.filter} value={spec.filter} onChange={(filter) => onChange({ filter })} />
          <Text label={proto.sampleHz} value={spec.sampleHz} onChange={(sampleHz) => onChange({ sampleHz })} />
        </FormGrid>
      );
    case "pwm":
      return (
        <FormGrid>
          <Text label="Duty min" value={spec.dutyMin} onChange={(dutyMin) => onChange({ dutyMin })} />
          <Text label="Duty max" value={spec.dutyMax} onChange={(dutyMax) => onChange({ dutyMax })} />
          <Text label={proto.initialValue} value={spec.initial} onChange={(initial) => onChange({ initial })} />
          <Text label="Safe state" value={spec.safeState} onChange={(safeState) => onChange({ safeState })} />
          <Text label={copy.propertyRangeMin} value={spec.rangeMin} onChange={(rangeMin) => onChange({ rangeMin })} />
          <Text label={copy.propertyRangeMax} value={spec.rangeMax} onChange={(rangeMax) => onChange({ rangeMax })} />
        </FormGrid>
      );
    case "dac":
      return (
        <FormGrid>
          <Text label={proto.resolutionBits} value={spec.resolution} onChange={(resolution) => onChange({ resolution })} />
          <Text label={proto.rangeMin} value={spec.rangeMin} onChange={(rangeMin) => onChange({ rangeMin })} />
          <Text label={proto.rangeMax} value={spec.rangeMax} onChange={(rangeMax) => onChange({ rangeMax })} />
          <Text label={proto.rawMin} value={spec.rawMin} onChange={(rawMin) => onChange({ rawMin })} />
          <Text label={proto.rawMax} value={spec.rawMax} onChange={(rawMax) => onChange({ rawMax })} />
          <Text label={proto.initialValue} value={spec.initial} onChange={(initial) => onChange({ initial })} />
          <Text label="Safe state" value={spec.safeState} onChange={(safeState) => onChange({ safeState })} />
        </FormGrid>
      );
    case "i2c":
      return (
        <FormGrid>
          <Text label={proto.registerAddress} value={spec.register} onChange={(register) => onChange({ register })} mono />
          <Text label={proto.length} value={spec.length} onChange={(length) => onChange({ length })} />
          <Select label="Signed" value={spec.signed ? "1" : "0"} options={[{ value: "0", label: "Unsigned" }, { value: "1", label: "Signed" }]} onChange={(signed) => onChange({ signed: signed === "1" })} />
          <Select label="Endianness" value={spec.endian} options={[{ value: "be", label: "Big" }, { value: "le", label: "Little" }]} onChange={(endian) => onChange({ endian: endian as "le" | "be" })} />
          <Text label="Bit start" value={spec.bitStart} onChange={(bitStart) => onChange({ bitStart })} />
          <Text label="Bit end" value={spec.bitEnd} onChange={(bitEnd) => onChange({ bitEnd })} />
        </FormGrid>
      );
    case "spi":
      return (
        <FormGrid>
          <Text label={proto.commandRegister} value={spec.command} onChange={(command) => onChange({ command })} mono />
          <Text label={proto.length} value={spec.length} onChange={(length) => onChange({ length })} />
          <Select label="Signed" value={spec.signed ? "1" : "0"} options={[{ value: "0", label: "Unsigned" }, { value: "1", label: "Signed" }]} onChange={(signed) => onChange({ signed: signed === "1" })} />
          <Select label="Endianness" value={spec.endian} options={[{ value: "be", label: "Big" }, { value: "le", label: "Little" }]} onChange={(endian) => onChange({ endian: endian as "le" | "be" })} />
          <Text label="Bitfield" value={spec.bitfield} onChange={(bitfield) => onChange({ bitfield })} wide />
        </FormGrid>
      );
    case "uart":
    case "raw-serial":
      return (
        <FormGrid>
          <Select
            label={proto.valueSource}
            value={spec.source}
            options={[
              { value: "json", label: proto.jsonField },
              { value: "csv", label: proto.csvIndex },
              { value: "regex", label: proto.regexGroup },
              { value: "binary", label: "Offset / length" },
            ]}
            onChange={(source) => onChange({ source: source as "json" | "csv" | "regex" | "binary" })}
          />
          <Text
            label={spec.source === "json" ? proto.jsonField : spec.source === "csv" ? proto.csvIndex : spec.source === "regex" ? proto.regexGroup : "Offset / length"}
            value={spec.path}
            onChange={(path) => onChange({ path })}
            mono
          />
          <Text label={proto.commandToSend} value={spec.command} onChange={(command) => onChange({ command })} wide mono />
        </FormGrid>
      );
    case "at":
      return (
        <FormGrid>
          <Text label={proto.readCommand} value={spec.readCommand} onChange={(readCommand) => onChange({ readCommand })} wide mono />
          <Text label={proto.writeCommand} value={spec.writeCommand} onChange={(writeCommand) => onChange({ writeCommand })} wide mono />
          <Text label={proto.responsePattern} value={spec.responsePattern} onChange={(responsePattern) => onChange({ responsePattern })} wide mono />
          <Text label={proto.extractField} value={spec.extractField} onChange={(extractField) => onChange({ extractField })} />
          <Text label={proto.params} value={spec.params} onChange={(params) => onChange({ params })} />
        </FormGrid>
      );
    case "modbus-rtu":
      return (
        <FormGrid>
          <Select
            label={proto.table}
            value={spec.table}
            options={[
              { value: "coil", label: "Coil" },
              { value: "discrete", label: "Discrete Input" },
              { value: "input", label: "Input Register" },
              { value: "holding", label: "Holding Register" },
            ]}
            onChange={(table) => onChange({ table: table as "coil" | "discrete" | "input" | "holding" })}
          />
          <Text label={proto.address} value={spec.address} onChange={(address) => onChange({ address })} />
          <Text label={copy.quantity} value={spec.quantity} onChange={(quantity) => onChange({ quantity })} />
          <Text label={proto.modbusFunction} value={spec.functionCode} onChange={(functionCode) => onChange({ functionCode })} />
          <Select
            label="Byte order"
            value={spec.byteOrder}
            options={[
              { value: "abcd", label: "ABCD" },
              { value: "badc", label: "BADC" },
              { value: "cdab", label: "CDAB" },
              { value: "dcba", label: "DCBA" },
            ]}
            onChange={(byteOrder) => onChange({ byteOrder: byteOrder as "abcd" | "badc" | "cdab" | "dcba" })}
          />
          <Select label="Word order" value={spec.wordOrder} options={[{ value: "ab", label: "AB" }, { value: "ba", label: "BA" }]} onChange={(wordOrder) => onChange({ wordOrder: wordOrder as "ab" | "ba" })} />
        </FormGrid>
      );
    case "can":
      return (
        <FormGrid>
          <Text label="CAN ID" value={spec.canId} onChange={(canId) => onChange({ canId })} mono />
          <Text label="Start bit" value={spec.startBit} onChange={(startBit) => onChange({ startBit })} />
          <Text label="Bit length" value={spec.bitLength} onChange={(bitLength) => onChange({ bitLength })} />
          <Select label="Signed" value={spec.signed ? "1" : "0"} options={[{ value: "0", label: "Unsigned" }, { value: "1", label: "Signed" }]} onChange={(signed) => onChange({ signed: signed === "1" })} />
          <Select label="Endianness" value={spec.endian} options={[{ value: "be", label: "Big" }, { value: "le", label: "Little" }]} onChange={(endian) => onChange({ endian: endian as "le" | "be" })} />
        </FormGrid>
      );
    case "w1":
      return (
        <FormGrid>
          <Text label={proto.command} value={spec.command} onChange={(command) => onChange({ command })} mono />
          <Text label="Offset" value={spec.offset} onChange={(offset) => onChange({ offset })} />
          <Text label={proto.length} value={spec.length} onChange={(length) => onChange({ length })} />
        </FormGrid>
      );
  }
}

function FormGrid({ children }: { readonly children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  mono,
  wide,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly mono?: boolean;
  readonly wide?: boolean;
}) {
  return (
    <label className={`block ${wide ? "col-span-2" : ""}`}>
      <span className="mb-1 block font-body text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-slsm border border-border-strong px-2 py-1.5 text-xs outline-none ${mono ? "font-mono" : "font-body"}`}
      />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  wide,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
  readonly wide?: boolean;
}) {
  return (
    <label className={`block ${wide ? "col-span-2" : ""}`}>
      <span className="mb-1 block font-body text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-body text-xs outline-none">
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function IconBtn({ label, onClick, danger, children }: { readonly label: string; readonly onClick: () => void; readonly danger?: boolean; readonly children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={`flex h-6 w-6 items-center justify-center rounded-slsm ${danger ? "text-ink-faint hover:text-error" : "text-ink-faint hover:bg-surface-raised hover:text-ink"}`}>
      {children}
    </button>
  );
}
