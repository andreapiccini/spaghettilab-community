import { normalizeTopologyPages, type TopologyIndex } from "@spaghettilab/catalog-model";
import { computeBudget, PortTransport, type DeviceProfileDraft, type Instruction, type SampleField } from "@spaghettilab/device-profile-authoring-model";
import { bytesEqual, encodeDeviceProfileCbor, instantiateModuleFromProfile, sha256, type ModuleInstantiationChoice } from "@spaghettilab/device-profile-install";
import { exportProfilePackage, importProfilePackageJson, resolveProfileInstall, type DeviceProfilePackage, type InstallResolutionResult } from "@spaghettilab/device-profile-package";
import type { CoreBindingId, CoreBindingRecord } from "@spaghettilab/domain";
import { setDeviceProfilePackages } from "@spaghettilab/domain";
import { parseW1RomHex, type ElectricalMode, type ModuleEndpoint } from "@spaghettilab/physical-composition-model";
import type { DeviceProfileSummary } from "@spaghettilab/protocol-sdk";
import { addGraphNodeCommand, physicalGraphLens } from "@spaghettilab/react-flow-adapter";
import { Download, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { deviceProfileCopy } from "../../lib/device-profile-copy.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { CompatibilityPanel } from "./CompatibilityPanel.js";
import { ImportExportDialog } from "./ImportExportDialog.js";
import { InstructionsTab } from "./InstructionsTab.js";
import { MetadataTab } from "./MetadataTab.js";
import { OutputTab } from "./OutputTab.js";
import { TransportTab } from "./TransportTab.js";

const TABS = ["metadata", "transport", "instructions", "output"] as const;
type Tab = (typeof TABS)[number];

function emptyDraft(): DeviceProfileDraft {
  return {
    profileId: "",
    version: 1,
    transport: PortTransport.I2C,
    requiredCapabilities: 0,
    maxTotalTimeMs: 200,
    maxTransactions: 8,
    maxBytes: 32,
    initOps: [],
    sampleOps: [],
    safeStopOps: [],
    sampleSchemaId: "",
    sampleSchemaVersion: 1,
    sampleFields: [],
  };
}

function packageKey(profileId: string, version: number): string {
  return `${profileId}@${version}`;
}

/**
 * `ux/screens/S060-device-profile-studio/{visual,ui-behavior,backend-behavior}.md`.
 * No canvas — a strict sequential step list per S061's own design (see the
 * screen's `visual.md` § "Perché questa schermata NON usa il canvas React
 * Flow"). Drag-to-reorder is simplified to up/down move buttons here (a real,
 * if lower-fidelity, interaction — not a data gap).
 */
export function DeviceProfileStudioScreen() {
  const { locale } = useLocale();
  const copy = deviceProfileCopy(locale);
  const { session, execute, navigate } = useSession();
  const { rows, getSnapshot, listDeviceProfiles, installProfile } = useCoreSessions();
  const bindings = session?.stack.current.coreBindings ?? [];

  const [tab, setTab] = useState<Tab>("metadata");
  const [draft, setDraft] = useState<DeviceProfileDraft>(emptyDraft());
  const [label, setLabel] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [savedKeys, setSavedKeys] = useState<ReadonlySet<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [instantiateOpen, setInstantiateOpen] = useState(false);

  const [selectedId, setSelectedId] = useState<CoreBindingId | null>(bindings[0]?.bindingId ?? null);
  const selected: CoreBindingRecord | null = bindings.find((b) => b.bindingId === selectedId) ?? bindings[0] ?? null;
  const bindingIndex = selected ? bindings.findIndex((b) => b.bindingId === selected.bindingId) : -1;
  const row = rows.find((r) => r.binding.bindingId === selected?.bindingId);
  const snapshot = selected ? getSnapshot(selected.bindingId) : undefined;
  const topologyIndex: TopologyIndex | null = useMemo(() => (snapshot?.topology ? normalizeTopologyPages([snapshot.topology], true) : null), [snapshot]);

  const idLocked = savedKeys.has(packageKey(draft.profileId, draft.version));
  const budget = useMemo(() => computeBudget(draft), [draft]);
  const exportPackage: DeviceProfilePackage | null = draft.profileId.trim() !== "" ? exportProfilePackage(draft, author) : null;

  const [resolution, setResolution] = useState<InstallResolutionResult | null>(null);
  const [installedSummary, setInstalledSummary] = useState<DeviceProfileSummary | null>(null);
  useEffect(() => {
    if (!selected || row?.sessionState !== "READY" || !exportPackage) return;
    let cancelled = false;
    (async () => {
      const [installedProfiles, expectedHash] = await Promise.all([listDeviceProfiles(selected.bindingId), sha256(encodeDeviceProfileCbor(draft))]);
      if (cancelled || !installedProfiles) return;
      const matched = installedProfiles.find((p) => p.profileId === exportPackage.profileId && p.version === exportPackage.version && bytesEqual(p.hash, expectedHash));
      const result = resolveProfileInstall(exportPackage, { installedProfiles, resources: snapshot?.resources }, { matchesInstalled: (installed) => bytesEqual(installed.hash, expectedHash) });
      if (!cancelled) {
        setResolution(result);
        setInstalledSummary(matched ?? null);
      }
    })().catch(() => {
      if (!cancelled) {
        setResolution(null);
        setInstalledSummary(null);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, row?.sessionState, draft, listDeviceProfiles, snapshot?.resources]);

  // Gated at read time instead of reset synchronously in the effect above (would
  // trip `react-hooks/set-state-in-effect`) — switching to a Core that isn't
  // READY, or clearing the profile ID, hides the previous resolution.
  const ready = Boolean(selected && row?.sessionState === "READY" && exportPackage);
  const visibleResolution = ready ? resolution : null;
  const visibleInstalledSummary = ready ? installedSummary : null;

  function persistPackages(pkg: DeviceProfilePackage) {
    if (!session || !execute) return;
    const key = packageKey(pkg.profileId, pkg.version);
    const existingJson = session.stack.current.deviceProfilePackages;
    const next = [...existingJson];
    const idx = next.findIndex((json) => {
      const parsed = importProfilePackageJson(json);
      return parsed.ok && packageKey(parsed.value.profileId, parsed.value.version) === key;
    });
    const json = JSON.stringify(pkg);
    if (idx >= 0) next[idx] = json;
    else next.push(json);
    execute(setDeviceProfilePackages(next));
    execute({
      kind: "UpdateAuthoringMetadata",
      apply: (project) => ({ ok: true, value: { ...project, authoringMetadata: { ...project.authoringMetadata, [`profile:${key}`]: { comment: label } } } }),
    });
    setSavedKeys((prev) => new Set(prev).add(key));
  }

  function handleSave() {
    if (!exportPackage) return;
    persistPackages(exportPackage);
  }

  async function handleInstall() {
    if (!selected || !exportPackage) return;
    setInstallBusy(true);
    try {
      const result = await installProfile(selected.bindingId, draft);
      if (result?.ok) {
        persistPackages(exportPackage);
      }
    } finally {
      setInstallBusy(false);
    }
  }

  function handleImport(pkg: DeviceProfilePackage) {
    setDraft(pkg.draft);
    setAuthor(pkg.author);
    setLabel(pkg.profileId);
    setSavedKeys((prev) => new Set(prev).add(packageKey(pkg.profileId, pkg.version)));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-surface px-4">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={copy.profileName} className="min-w-0 flex-1 truncate bg-transparent font-heading text-lg font-semibold text-ink outline-none" />
        <button type="button" onClick={() => setImportOpen(true)} className="flex h-9 items-center gap-1.5 rounded-slsm border border-border-strong px-3 font-body text-sm text-ink hover:bg-surface-raised">
          <Upload size={16} />
          {copy.importAction}
        </button>
        <button type="button" onClick={() => setExportOpen(true)} disabled={!exportPackage} className="flex h-9 items-center gap-1.5 rounded-slsm border border-border-strong px-3 font-body text-sm text-ink hover:bg-surface-raised disabled:opacity-50">
          <Download size={16} />
          {copy.exportAction}
        </button>
        <button type="button" onClick={handleSave} disabled={!exportPackage} className="rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:opacity-50">
          {copy.saveProfile}
        </button>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-surface px-4">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-slpill px-3 py-1.5 font-body text-sm ${tab === t ? "bg-brand-blue text-white" : "text-ink-muted hover:bg-surface-raised"}`}>
            {copy.tabs[t]}
          </button>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
          {tab === "metadata" && <MetadataTab label={label} onLabel={setLabel} profileId={draft.profileId} idLocked={idLocked} onProfileId={(v) => setDraft({ ...draft, profileId: v })} version={draft.version} onVersion={(v) => setDraft({ ...draft, version: v })} author={author} onAuthor={setAuthor} description={description} onDescription={setDescription} />}
          {tab === "transport" && <TransportTab transport={draft.transport} onTransport={(v) => setDraft({ ...draft, transport: v })} requiredCapabilities={draft.requiredCapabilities} onRequiredCapabilities={(v) => setDraft({ ...draft, requiredCapabilities: v })} />}
          {tab === "instructions" && (
            <InstructionsTab
              initOps={draft.initOps}
              sampleOps={draft.sampleOps}
              safeStopOps={draft.safeStopOps}
              onInitOps={(v: readonly Instruction[]) => setDraft({ ...draft, initOps: v })}
              onSampleOps={(v: readonly Instruction[]) => setDraft({ ...draft, sampleOps: v })}
              onSafeStopOps={(v: readonly Instruction[]) => setDraft({ ...draft, safeStopOps: v })}
            />
          )}
          {tab === "output" && (
            <OutputTab
              schemaId={draft.sampleSchemaId}
              onSchemaId={(v) => setDraft({ ...draft, sampleSchemaId: v })}
              schemaVersion={draft.sampleSchemaVersion}
              onSchemaVersion={(v) => setDraft({ ...draft, sampleSchemaVersion: v })}
              fields={draft.sampleFields}
              onFields={(v: readonly SampleField[]) => setDraft({ ...draft, sampleFields: v })}
            />
          )}
        </div>

        <CompatibilityPanel
          bindings={bindings}
          selected={selected}
          onSelect={(b) => setSelectedId(b.bindingId)}
          resolution={visibleResolution}
          budget={budget}
          maxBudget={draft}
          onInstall={() => void handleInstall()}
          onInstantiate={() => setInstantiateOpen(true)}
          busy={installBusy}
        />
      </div>

      {importOpen && <ImportExportDialog mode="import" onImport={handleImport} onClose={() => setImportOpen(false)} />}
      {exportOpen && exportPackage && <ImportExportDialog mode="export" exportPackage={exportPackage} onImport={() => {}} onClose={() => setExportOpen(false)} />}

      {instantiateOpen && selected && bindingIndex >= 0 && visibleInstalledSummary && (
        <InstantiateDialog
          topology={topologyIndex}
          transport={draft.transport}
          onCancel={() => setInstantiateOpen(false)}
          onConfirm={(choice) => {
            if (!execute || !visibleResolution || visibleResolution.kind !== "READY" || !visibleInstalledSummary) return;
            const moduleData = instantiateModuleFromProfile(visibleInstalledSummary, choice);
            const id = `pc-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
            execute(addGraphNodeCommand(physicalGraphLens(bindingIndex), { layer: "physical-composition", id, data: moduleData }));
            setInstantiateOpen(false);
            navigate("physical-composition");
          }}
        />
      )}
    </div>
  );
}

function InstantiateDialog({
  topology,
  transport,
  onCancel,
  onConfirm,
}: {
  readonly topology: TopologyIndex | null;
  readonly transport: number;
  readonly onCancel: () => void;
  readonly onConfirm: (choice: ModuleInstantiationChoice) => void;
}) {
  const { locale } = useLocale();
  const copy = deviceProfileCopy(locale);
  const firstFlow = topology?.flows[0];
  const firstBay = firstFlow?.bays[0];
  const [portId, setPortId] = useState(firstFlow?.portId ?? -1);
  const [bayId, setBayId] = useState(firstBay?.bayId ?? -1);
  const [railId, setRailId] = useState(firstBay?.rails[0]?.railId ?? -1);
  const [electricalMode, setElectricalMode] = useState<ElectricalMode>("input-output");
  const [addressDraft, setAddressDraft] = useState("");
  const [chipSelectDraft, setChipSelectDraft] = useState("");
  const [w1RomDraft, setW1RomDraft] = useState("");
  const flow = topology?.flows.find((f) => f.portId === portId);
  const bay = flow?.bays.find((b) => b.bayId === bayId);
  const w1RomParsed = w1RomDraft.trim() === "" ? undefined : parseW1RomHex(w1RomDraft);
  const w1RomInvalid = transport === PortTransport.W1 && (w1RomDraft.trim() === "" || w1RomParsed === undefined);
  const canConfirm = portId !== -1 && bayId !== -1 && railId !== -1 && !w1RomInvalid;

  function endpointOf(): ModuleEndpoint | undefined {
    if (transport === PortTransport.I2C && addressDraft !== "") return { address: Number(addressDraft) };
    if (transport === PortTransport.SPI && chipSelectDraft !== "") return { chipSelect: Number(chipSelectDraft) };
    if (transport === PortTransport.W1 && w1RomParsed) return { w1Rom: w1RomParsed };
    return undefined;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,23,31,.35)]" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-96 rounded-sllg bg-surface p-6 shadow-e3">
        <h2 className="mb-4 font-heading text-lg font-semibold text-ink">{copy.instantiate}</h2>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted">Port</label>
        <select value={portId} onChange={(e) => setPortId(Number(e.target.value))} className="mb-3 w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none">
          <option value={-1}>—</option>
          {(topology?.flows ?? []).map((f) => (
            <option key={f.flowId} value={f.portId}>
              Port {f.portId}
            </option>
          ))}
        </select>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted">Bay</label>
        <select value={bayId} onChange={(e) => setBayId(Number(e.target.value))} className="mb-3 w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none">
          <option value={-1}>—</option>
          {(flow?.bays ?? []).map((b) => (
            <option key={b.bayId} value={b.bayId}>
              Bay {b.ordinal}
            </option>
          ))}
        </select>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted">Rail</label>
        <select value={railId} onChange={(e) => setRailId(Number(e.target.value))} className="mb-3 w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none">
          <option value={-1}>—</option>
          {(bay?.rails ?? []).map((r) => (
            <option key={r.railId} value={r.railId}>
              Rail {r.railId}
            </option>
          ))}
        </select>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted">{copy.electricalMode}</label>
        <select value={electricalMode} onChange={(e) => setElectricalMode(e.target.value as ElectricalMode)} className="mb-4 w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none">
          <option value="input-only">input-only</option>
          <option value="output-only">output-only</option>
          <option value="input-output">input-output</option>
        </select>
        {transport === PortTransport.I2C && (
          <>
            <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="inst-i2c">
              {copy.i2cAddress}
            </label>
            <input id="inst-i2c" type="number" value={addressDraft} onChange={(e) => setAddressDraft(e.target.value)} className="mb-4 w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none" />
          </>
        )}
        {transport === PortTransport.SPI && (
          <>
            <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="inst-spi">
              Chip-select SPI (spi_cs)
            </label>
            <input id="inst-spi" type="number" value={chipSelectDraft} onChange={(e) => setChipSelectDraft(e.target.value)} className="mb-4 w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none" />
          </>
        )}
        {transport === PortTransport.W1 && (
          <>
            <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="inst-w1">
              ROM 1-Wire (w1_rom)
            </label>
            <input id="inst-w1" value={w1RomDraft} placeholder="28FF641F0000003D" onChange={(e) => setW1RomDraft(e.target.value)} className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none" style={{ borderColor: w1RomInvalid && w1RomDraft.trim() !== "" ? "var(--color-error)" : undefined }} />
            <p className="mb-4 mt-1 font-body text-xs text-ink-faint">{copy.w1Help}</p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-slsm px-4 py-2 font-body text-sm text-ink-muted hover:bg-surface-raised">
            {copy.cancel}
          </button>
          <button type="button" onClick={() => onConfirm({ portId, bayId, railId, electricalMode, endpoint: endpointOf() })} disabled={!canConfirm} className="rounded-slsm bg-brand-blue px-4 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:opacity-50">
            {copy.instantiateAction}
          </button>
        </div>
      </div>
    </div>
  );
}
