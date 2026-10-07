import { PhysicalInterfaceEditor } from "./PhysicalInterfaceEditor.js";
import { addConfirmedPinModules } from "../../lib/physical-pin-bindings.js";
import { useCommunityHub } from "../../state/community-hub-context.js";
import { hubCatalog } from "../../lib/community-hub.js";
import {
  type GetStatusResponse,
  type NfcTagStatus,
  type PhysicalBackbone,
  DEFAULT_PHYSICAL_SETTINGS,
  encodePhysicalSettings,
} from "@spaghettilab/protocol-sdk";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Cable,
  Check,
  ChevronRight,
  Cpu,
  Layers,
  LoaderCircle,
  LockKeyhole,
  Radio,
  RefreshCw,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  PHYSICAL_CATALOG,
  PHYSICAL_META_KEY,
  catalogEntry,
  expectedFunctionTag,
  parsePhysicalCatalog,
  parsePhysicalProject,
  pinsForModes,
  tagForSlot,
  topologyForBoard,
  validatePhysicalModes,
  type BackbonePhysicalDraft,
  type PhysicalCatalogEntry,
  type PhysicalProject,
} from "../../lib/backbone-physical.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import { emptyProtocol, type CustomProtocol } from "../../lib/port-protocol-mock.js";
import {
  attachedFromStatus,
  useCoreSessions,
  type AttachedBackbone,
} from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { CoreSelector } from "../catalog-topology/CoreSelector.js";
import { PortMappingEditor } from "./PortMappingEditor.js";

const control =
  "w-full rounded-slmd border border-border-strong bg-surface px-3 py-2 font-body text-sm text-ink focus:border-brand-blue focus:outline-none";
const action =
  "inline-flex items-center justify-center gap-2 rounded-slpill bg-brand-blue px-4 py-2 font-body-strong text-sm text-white transition-colors hover:bg-brand-blue-dark disabled:opacity-40";
const secondary =
  "inline-flex items-center justify-center gap-2 rounded-slpill border border-border-strong px-3 py-2 font-body text-sm text-ink transition-colors hover:bg-surface-raised disabled:opacity-40";

function storeStableBoardDraft(
  drafts: PhysicalProject["drafts"],
  stableKey: string,
  legacyKey: string,
  draft: BackbonePhysicalDraft,
): Readonly<Record<string, BackbonePhysicalDraft>> {
  const next = { ...drafts, [stableKey]: draft };
  if (legacyKey && legacyKey !== stableKey) delete next[legacyKey];
  return next;
}

export function BackbonePhysicalScreen() {
  const hub = useCommunityHub();
  const { locale } = useLocale();
  const it = locale === "it";
  const { session, execute, navigate, physicalTarget } = useSession();
  const { rows, getSnapshot, getClient, observeStatus, discoverNetwork } = useCoreSessions();
  const bindings = session?.stack.current.coreBindings ?? [];
  const [bindingId, setBindingId] = useState<string | null>(
    physicalTarget?.bindingId ?? null,
  );
  const selected =
    bindings.find((binding) => binding.bindingId === bindingId) ?? bindings[0] ?? null;
  const row = rows.find((item) => item.binding.bindingId === selected?.bindingId);
  const snapshot = selected ? getSnapshot(selected.bindingId) : undefined;
  const [boardId, setBoardId] = useState<string | null>(
    physicalTarget?.deviceIdHex ?? null,
  );
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const status = snapshot?.status;
  const physicalProject = parsePhysicalProject(
    session?.stack.current.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  );
  const sharedCatalog = hub.snapshot ? hubCatalog(hub.snapshot) : PHYSICAL_CATALOG;
  const catalog = [
    ...physicalProject.catalog,
    ...sharedCatalog.filter(
      (entry) =>
        !physicalProject.catalog.some(
          (custom) =>
            custom.registryId === entry.registryId &&
            custom.vendorId === entry.vendorId &&
            custom.moduleTypeId === entry.moduleTypeId,
        ),
    ),
  ];

  const fallback: AttachedBackbone = {
    deviceIdHex: selected?.expectedDeviceId ?? "",
    mac: "",
    nodeId: status?.chainPeers?.find((peer) => peer.local)?.nodeId ?? 0,
    local: true,
  };
  const boards = row?.attachedBackbones.length
    ? row.attachedBackbones
    : selected
      ? [fallback]
      : [];
  const board = boards.find((item) => item.deviceIdHex === boardId) ?? boards[0];
  const stableBoardKey =
    board && selected ? `${selected.bindingId}:${board.deviceIdHex}` : "";
  const legacyMasterKey =
    board?.local && selected
      ? `${selected.bindingId}:${selected.expectedDeviceId}`
      : "";
  const topology = board ? topologyForBoard(status, board) : undefined;
  const ready = row?.sessionState === "READY";

  function saveProject(next: PhysicalProject) {
    execute?.({
      kind: "SaveBackbonePhysicalComposition",
      apply: (project) => ({
        ok: true,
        value: {
          ...project,
          authoringMetadata: {
            ...project.authoringMetadata,
            [PHYSICAL_META_KEY]: { comment: JSON.stringify(next) },
          },
        },
      }),
    });
  }

  async function refresh() {
    if (!selected) return;
    const client = getClient(selected.bindingId);
    if (!client) return;
    setRefreshing(true);
    setMessage("");
    try {
      const next = await client.getStatus();
      observeStatus(selected.bindingId, next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-sunken">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-4">
        <CoreSelector
          bindings={bindings}
          selected={selected}
          onSelect={(binding) => {
            setBindingId(binding.bindingId);
            setBoardId(null);
            setMessage("");
          }}
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-2xl font-bold text-ink">
            Physical composition
          </h1>
          <p className="mt-1 font-body text-xs text-ink-muted">
            {it
              ? "Backbone, moduli e porte · la struttura reale del tuo sistema"
              : "Backbones, modules and ports · your system’s physical structure"}
          </p>
        </div>
        <button className={secondary} onClick={() => setCatalogOpen(true)}>
          <Layers size={15} />
          {it ? "Catalogo NFC" : "NFC catalog"}
          <span className="rounded-slpill bg-surface-sunken px-2 text-xs">
            {catalog.length}
          </span>
        </button>
        <button
          className={secondary}
          disabled={!ready || refreshing}
          onClick={() => void refresh()}
          aria-label={it ? "Aggiorna struttura" : "Refresh structure"}
        >
          <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
        </button>
      </header>
      {message && (
        <div
          role="alert"
          className="border-b border-border px-5 py-3 text-sm text-error"
        >
          {message}
        </div>
      )}
      {!selected ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <Cable size={44} className="text-ink-faint" />
          <p className="text-ink-muted">
            {it
              ? "Collega una backbone per leggerne la struttura."
              : "Connect a Backbone to read its structure."}
          </p>
          <button className={action} onClick={() => navigate("core-connections")}>
            {it ? "Apri Clusters" : "Open Clusters"}
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="flex shrink-0 gap-2 overflow-auto border-b border-border bg-surface p-3 lg:w-64 lg:flex-col lg:border-b-0 lg:border-r">
            <p className="hidden px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-ink-faint lg:block">
              {it ? "Backbone nel cluster" : "Backbones in this cluster"}
            </p>
            {boards.map((item, index) => {
              const layout = topologyForBoard(status, item);
              const active = item.deviceIdHex === board?.deviceIdHex;
              return (
                <button
                  key={item.deviceIdHex || item.nodeId}
                  onClick={() => setBoardId(item.deviceIdHex)}
                  className={`flex shrink-0 items-center gap-3 rounded-slmd border p-3 text-left transition-colors ${active ? "border-brand-blue bg-brand-blue/10" : "border-transparent hover:bg-surface-raised"}`}
                >
                  <Cpu
                    size={22}
                    className={active ? "text-brand-blue" : "text-ink-faint"}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">
                      Backbone {index + 1}{" "}
                      {item.local && (
                        <span className="text-[10px] text-brand-blue">MASTER</span>
                      )}
                    </div>
                    <div className="mt-1 truncate font-mono text-[10px] text-ink-faint">
                      {item.mac || item.deviceIdHex}
                    </div>
                    <div className="mt-1 text-xs text-ink-muted">
                      {layout?.mcu ??
                        (it ? "Struttura non ricevuta" : "Layout not received")}
                    </div>
                  </div>
                  <ChevronRight size={14} className="ml-auto shrink-0 text-ink-faint" />
                </button>
              );
            })}
          </aside>
          {board && (
            <BoardDetail
              key={`${session?.projectId}:${selected.bindingId}:${board.deviceIdHex}:${board.nodeId}`}
              board={board}
              topology={topology}
              status={status}
              ready={ready}
              catalog={catalog}
              saved={
                physicalProject.drafts[stableBoardKey] ??
                (legacyMasterKey
                  ? physicalProject.drafts[legacyMasterKey]
                  : undefined)
              }
              onSave={(draft) =>
                saveProject({
                  ...physicalProject,
                  drafts: storeStableBoardDraft(
                    physicalProject.drafts,
                    stableBoardKey,
                    legacyMasterKey,
                    { ...draft, applied: false },
                  ),
                })
              }
              onRegister={(entry) =>
                saveProject({
                  ...physicalProject,
                  catalog: [
                    ...physicalProject.catalog.filter(
                      (existing) =>
                        !(
                          existing.registryId === entry.registryId &&
                          existing.vendorId === entry.vendorId &&
                          existing.moduleTypeId === entry.moduleTypeId
                        ),
                    ),
                    entry,
                  ],
                })
              }
              onApply={async (draft) => {
                const client = getClient(selected.bindingId);
                if (!client || !ready)
                  throw new Error(
                    it
                      ? "La backbone deve essere connessa."
                      : "The Backbone must be connected.",
                  );
                const fresh = (await discoverNetwork()).find(
                  (item) => item.bindingId === selected.bindingId,
                )?.status;
                const currentBoard = attachedFromStatus(
                  fresh,
                  selected.expectedDeviceId,
                )?.find((item) => item.deviceIdHex === board.deviceIdHex);
                if (!fresh || !currentBoard)
                  throw new Error(
                    it
                      ? "La Backbone selezionata non è più disponibile."
                      : "The selected Backbone is no longer available.",
                  );
                await client.applyPhysical({
                  nodeId: currentBoard.local ? 0 : currentBoard.nodeId,
                  modes: new Uint8Array(draft.modes),
                  i2cSpeed: draft.i2cSpeed,
                  settings:
                    topology?.version === 2
                      ? (draft.settings ?? DEFAULT_PHYSICAL_SETTINGS)
                      : undefined,
                  expectedTag: expectedFunctionTag(
                    tagForSlot(status, board, 2),
                    draft.automatic,
                  ),
                });
                const next = await client.getStatus();
                observeStatus(selected.bindingId, next);
                const actual = topologyForBoard(next, currentBoard);
                if (
                  !actual ||
                  actual.modes.some((mode, index) => mode !== draft.modes[index]) ||
                  actual.i2cSpeed !== draft.i2cSpeed
                )
                  throw new Error(
                    "La board non ha confermato la configurazione dei pin.",
                  );
                if (
                  draft.settings &&
                  actual.settings &&
                  encodePhysicalSettings(draft.settings).some(
                    (byte, i) => byte !== encodePhysicalSettings(actual.settings!)[i],
                  )
                )
                  throw new Error(
                    "La board non ha confermato le impostazioni dell’interfaccia.",
                  );
                const confirmed = {
                  ...draft,
                  settings: actual.settings,
                  applied: true,
                  nodeId: currentBoard.nodeId,
                  local: currentBoard.local,
                  backendPortId: actual.backendPortId,
                };
                execute?.({
                  kind: "ConfirmPhysicalPins",
                  apply: (project) => {
                    const current = parsePhysicalProject(
                      project.authoringMetadata[PHYSICAL_META_KEY]?.comment,
                    );
                    const updated = addConfirmedPinModules(
                      project,
                      selected.bindingId,
                      stableBoardKey,
                      confirmed,
                      legacyMasterKey && legacyMasterKey !== stableBoardKey
                        ? [legacyMasterKey]
                        : [],
                    );
                    return {
                      ok: true,
                      value: {
                        ...updated,
                        authoringMetadata: {
                          ...updated.authoringMetadata,
                          [PHYSICAL_META_KEY]: {
                            comment: JSON.stringify({
                              ...current,
                              drafts: storeStableBoardDraft(
                                current.drafts,
                                stableBoardKey,
                                legacyMasterKey,
                                confirmed,
                              ),
                            }),
                          },
                        },
                      },
                    };
                  },
                });
              }}
            />
          )}
        </div>
      )}
      <AnimatePresence>
        {catalogOpen && (
          <CatalogDialog
            entries={catalog}
            onClose={() => setCatalogOpen(false)}
            onImport={(entries) =>
              saveProject({ ...physicalProject, catalog: entries })
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function BoardDetail({
  board,
  topology,
  status,
  ready,
  catalog,
  saved,
  onSave,
  onRegister,
  onApply,
}: {
  readonly board: AttachedBackbone;
  readonly topology?: PhysicalBackbone;
  readonly status?: GetStatusResponse;
  readonly ready: boolean;
  readonly catalog: readonly PhysicalCatalogEntry[];
  readonly saved?: BackbonePhysicalDraft;
  readonly onSave: (draft: BackbonePhysicalDraft) => void;
  readonly onRegister: (entry: PhysicalCatalogEntry) => void;
  readonly onApply: (draft: BackbonePhysicalDraft) => Promise<void>;
}) {
  const { locale } = useLocale();
  const it = locale === "it";
  const reducedMotion = useReducedMotion();
  const [port, setPort] = useState<"connector" | "mirror" | "user">("user");
  const [draft, setDraft] = useState<BackbonePhysicalDraft>(
    saved ?? {
      name: "",
      modes: topology?.modes ?? [0, 0, 0, 0],
      i2cSpeed: topology?.i2cSpeed ?? 0,
      settings: topology?.settings ?? DEFAULT_PHYSICAL_SETTINGS,
    },
  );
  const [seeded, setSeeded] = useState(!!topology || !!saved);
  if (!seeded && topology) {
    setSeeded(true);
    setDraft({
      name: "",
      modes: topology.modes,
      i2cSpeed: topology.i2cSpeed,
      settings: topology.settings ?? DEFAULT_PHYSICAL_SETTINGS,
    });
  }
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [protocolOpen, setProtocolOpen] = useState(false);
  const connectorTag = tagForSlot(status, board, 1);
  const functionTag = tagForSlot(status, board, 2);
  const connectorDefinition = catalogEntry(connectorTag, catalog);
  const functionDefinition = catalogEntry(functionTag, catalog);
  const localAutomatic =
    !!functionDefinition?.modes &&
    !validatePhysicalModes(functionDefinition.modes, functionDefinition.i2cSpeed ?? 0);
  const automatic = localAutomatic || (topology?.source === 2 && !!functionTag);
  const effective: BackbonePhysicalDraft = localAutomatic
    ? {
        name: functionDefinition!.name,
        modes: functionDefinition!.modes!,
        i2cSpeed: functionDefinition!.i2cSpeed ?? 0,
        protocol: functionDefinition!.protocol,
        settings: functionDefinition!.settings ?? DEFAULT_PHYSICAL_SETTINGS,
        automatic: true,
      }
    : automatic
      ? {
          name: functionDefinition?.name ?? "NFC module",
          modes: topology!.modes,
          i2cSpeed: topology!.i2cSpeed,
          settings: topology!.settings,
          automatic: true,
        }
      : draft;
  const attempted = useRef<string | null>(null);
  const onApplyRef = useRef(onApply);
  useEffect(() => {
    onApplyRef.current = onApply;
  }, [onApply]);
  const autoKey =
    automatic && functionTag
      ? `${board.nodeId}:${[...functionTag.uid]}:${effective.modes}:${effective.i2cSpeed}:${JSON.stringify(effective.settings)}`
      : "";
  const autoModes = effective.modes.join(",");
  const autoSpeed = effective.i2cSpeed;
  const autoSettings = JSON.stringify(effective.settings ?? DEFAULT_PHYSICAL_SETTINGS);
  useEffect(() => {
    if (!autoKey || !ready || !topology || attempted.current === autoKey) return;
    attempted.current = autoKey;
    if (
      topology.source === 2 &&
      topology.modes.join(",") === autoModes &&
      topology.i2cSpeed === autoSpeed
    )
      return;
    let cancelled = false;
    void onApplyRef
      .current({
        name: "NFC",
        modes: autoModes.split(",").map(Number),
        i2cSpeed: autoSpeed,
        settings: JSON.parse(autoSettings),
        automatic: true,
      })
      .then(() => {
        if (!cancelled)
          setResult({
            ok: true,
            text: it
              ? "Configurazione NFC applicata alla backbone."
              : "NFC configuration applied to the Backbone.",
          });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResult({
            ok: false,
            text: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [autoKey, autoModes, autoSpeed, autoSettings, ready, topology, it]);

  async function apply() {
    const invalid = validatePhysicalModes(effective.modes, effective.i2cSpeed);
    if (invalid) {
      setResult({ ok: false, text: invalid });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await onApply(effective);
      setResult({
        ok: true,
        text: it
          ? "Pin applicati, salvati e confermati dal microcontrollore."
          : "Pins applied, saved and acknowledged by the microcontroller.",
      });
    } catch (error) {
      setResult({
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  const connectorPins =
    connectorDefinition?.pins ?? Array.from({ length: 6 }, () => "?");
  const userPins = pinsForModes(effective.modes);
  const knownLayout = topology?.layout === 1;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto xl:flex-row xl:overflow-hidden">
      <main className="min-w-0 shrink-0 p-5 lg:p-8 xl:flex-1 xl:overflow-auto">
        <div className="mb-7 flex flex-wrap items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-slmd bg-brand-blue/10 text-brand-blue">
            <Cpu size={26} />
          </span>
          <div>
            <h2 className="font-heading text-xl font-bold text-ink">
              {topology?.mcu ?? "Backbone"}
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              {topology
                ? `${topology.antennas} ${it ? "antenne NFC" : "NFC antennas"} · ${knownLayout ? `2 ${it ? "alloggiamenti" : "module positions"} · 3 ${it ? "porte" : "ports"}` : `Layout ${topology.layout}`}`
                : it
                  ? "Aggiorna il firmware per ricevere la struttura fisica."
                  : "Update the firmware to receive its physical layout."}
            </p>
          </div>
          <span
            className={`ml-auto rounded-slpill px-3 py-1 text-xs ${ready ? "bg-success/10 text-success" : "bg-surface text-ink-faint"}`}
          >
            {ready
              ? it
                ? "Connessa"
                : "Connected"
              : it
                ? "Non connessa"
                : "Disconnected"}
          </span>
        </div>
        {!knownLayout ? (
          <div className="rounded-slmd border border-border bg-surface p-6 text-sm text-ink-muted">
            {it
              ? "Questa backbone non ha ancora comunicato una topologia supportata. Le porte diventano configurabili quando arriva la descrizione dal firmware."
              : "This Backbone has not reported a supported topology yet. Port configuration becomes available when its firmware reports the layout."}
          </div>
        ) : (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTokens.duration.base}
            className="space-y-5"
          >
            <ModuleCard
              name="Connector"
              antenna={1}
              tag={connectorTag}
              definition={connectorDefinition}
              it={it}
            >
              <PortTile
                title={it ? "Porta 1" : "Port 1"}
                subtitle={
                  it
                    ? "Definita dal modulo · sola lettura"
                    : "Module-defined · read only"
                }
                pins={connectorPins}
                active={port === "connector"}
                onSelect={() => setPort("connector")}
                locked
              />
            </ModuleCard>
            <div className="ml-7 flex items-center gap-3 text-xs text-ink-faint">
              <span className="h-7 w-px bg-brand-blue/30" />
              <Cable size={15} />
              {it
                ? "Collegamento pin-to-pin · 1→1 … 6→6"
                : "Pin-to-pin connection · 1→1 … 6→6"}
            </div>
            <ModuleCard
              name="Function"
              antenna={2}
              tag={functionTag}
              definition={functionDefinition}
              it={it}
            >
              <PortTile
                title={it ? "Porta 1" : "Port 1"}
                subtitle={
                  it ? "Specchio della porta Connector" : "Mirrors the Connector port"
                }
                pins={connectorPins}
                active={port === "mirror"}
                onSelect={() => setPort("mirror")}
                locked
              />
              <PortTile
                title={it ? "Porta 2" : "Port 2"}
                subtitle={
                  automatic
                    ? it
                      ? "Configurazione automatica NFC"
                      : "Automatic NFC configuration"
                    : it
                      ? "4 segnali sul micro · configurabili"
                      : "4 MCU signals · configurable"
                }
                pins={userPins}
                active={port === "user"}
                onSelect={() => setPort("user")}
                locked={!!automatic}
              />
            </ModuleCard>
            <p className="px-1 text-xs leading-relaxed text-ink-faint">
              {it
                ? "La porta 2 di Function mantiene sempre 5V sul pin 1 e GND sul pin 6. Le interfacce disponibili dipendono dal cablaggio e dal firmware della backbone selezionata."
                : "Function port 2 always has 5V on pin 1 and GND on pin 6. Available interfaces depend on the selected Backbone’s wiring and firmware."}
            </p>
          </motion.div>
        )}
      </main>
      {knownLayout && (
        <section className="w-full shrink-0 border-t border-border bg-surface p-5 xl:w-[390px] xl:overflow-auto xl:border-l xl:border-t-0">
          <div className="mb-5 flex items-center gap-2">
            <Settings2 size={17} className="text-brand-blue" />
            <h3 className="font-heading text-base font-semibold text-ink">
              {port === "connector" ? "Connector · " : "Function · "}
              {it ? "Porta" : "Port"} {port === "user" ? "2" : "1"}
            </h3>
          </div>
          {port !== "user" ? (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-ink-muted">
                {it
                  ? "I pin di questa porta dipendono dal modulo Connector. La porta 1 di Function replica lo stesso collegamento, senza configurazione indipendente."
                  : "These pins are defined by the Connector module. Function port 1 mirrors the same wiring without independent configuration."}
              </p>
              <PinList pins={connectorPins} />
              <p className="rounded-slmd bg-surface-sunken p-3 text-xs text-ink-muted">
                {connectorDefinition?.pins
                  ? it
                    ? "Pinout letto dal catalogo NFC."
                    : "Pinout read from the NFC catalog."
                  : it
                    ? "Pinout sconosciuto: il catalogo non contiene una definizione elettrica per questo modulo."
                    : "Unknown pinout: the catalog has no electrical definition for this module."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="block text-xs text-ink-muted">
                {it ? "Modulo connesso" : "Connected module"}
                <input
                  className={`${control} mt-2`}
                  placeholder={
                    it ? "Nome del modulo personalizzato" : "Custom module name"
                  }
                  value={effective.name}
                  disabled={!!automatic || busy}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <p className="rounded-slmd bg-surface-sunken p-3 text-xs leading-relaxed text-ink-muted">
                {automatic
                  ? it
                    ? "Modulo riconosciuto: il catalogo configura automaticamente i segnali. I pin sono in sola lettura."
                    : "Recognized module: the catalog configures signals automatically. Pins are read only."
                  : functionTag
                    ? it
                      ? "Tag NFC letto, definizione elettrica assente. Puoi creare una configurazione personalizzata."
                      : "NFC tag read, electrical definition missing. You can create a custom configuration."
                    : it
                      ? "Nessun modulo NFC rilevato. Assegna i segnali al modulo personalizzato."
                      : "No NFC module detected. Assign signals to your custom module."}
              </p>
              <PhysicalInterfaceEditor
                draft={effective}
                capabilities={topology.capabilities}
                extended={topology.version === 2}
                disabled={!!automatic || busy}
                onChange={setDraft}
              />
              {!automatic && (
                <button
                  className={`${secondary} w-full`}
                  onClick={() => {
                    if (!draft.protocol)
                      setDraft({
                        ...draft,
                        protocol: emptyProtocol(
                          `physical-${board.nodeId}`,
                          draft.name,
                          draft.modes.includes(4)
                            ? "i2c"
                            : draft.modes.includes(6)
                              ? "uart"
                              : draft.modes.includes(8)
                                ? "spi"
                                : draft.modes.includes(12)
                                  ? "pwm"
                                  : "gpio",
                        ),
                      });
                    setProtocolOpen(!protocolOpen);
                  }}
                >
                  {it ? "Protocollo e campi del modulo" : "Module protocol and fields"}
                </button>
              )}
              {protocolOpen && effective.protocol && (
                <div className="rounded-slmd border border-border p-3">
                  <PortMappingEditor
                    protocol={effective.protocol}
                    onChange={(protocol: CustomProtocol) =>
                      setDraft({ ...draft, protocol })
                    }
                    onDone={() => {
                      onSave(draft);
                      setProtocolOpen(false);
                    }}
                  />
                  <p className="mt-2 text-xs text-ink-faint">
                    {it
                      ? "I campi vengono salvati nel progetto; usa Device Profiles per installarne l’esecuzione sul dispositivo."
                      : "Fields are saved in the project; use Device Profiles to install their execution on the device."}
                  </p>
                </div>
              )}
              {result && (
                <p
                  role="status"
                  className={`rounded-slmd p-3 text-xs ${result.ok ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}
                >
                  {result.text}
                </p>
              )}
              <button
                className={`${action} w-full`}
                disabled={
                  !ready ||
                  busy ||
                  !!validatePhysicalModes(effective.modes, effective.i2cSpeed)
                }
                onClick={() => void apply()}
              >
                {busy ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Check size={16} />
                )}
                {automatic
                  ? it
                    ? "Riapplica configurazione NFC"
                    : "Reapply NFC configuration"
                  : it
                    ? "Applica pin alla backbone"
                    : "Apply pins to Backbone"}
              </button>
              {!automatic && (
                <button
                  className={`${secondary} w-full`}
                  disabled={busy}
                  onClick={() => {
                    onSave(draft);
                    setResult({
                      ok: true,
                      text: it
                        ? "Bozza salvata nel progetto."
                        : "Draft saved in the project.",
                    });
                  }}
                >
                  {it ? "Salva bozza" : "Save draft"}
                </button>
              )}
              {functionTag && !automatic && (
                <button
                  className={`${secondary} w-full`}
                  disabled={!draft.name.trim() || busy}
                  onClick={() => {
                    onRegister({
                      registryId: functionTag.registryId ?? 0,
                      vendorId: functionTag.vendorId ?? 0,
                      moduleTypeId: functionTag.moduleTypeId ?? 0,
                      name: draft.name,
                      pins: userPins,
                      modes: draft.modes,
                      i2cSpeed: draft.i2cSpeed,
                      settings: draft.settings,
                      protocol: draft.protocol,
                    });
                    setResult({
                      ok: true,
                      text: it
                        ? "Definizione aggiunta al catalogo di questo progetto."
                        : "Definition added to this project’s catalog.",
                    });
                  }}
                >
                  {it ? "Associa al tag nel catalogo" : "Associate with tag in catalog"}
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ModuleCard({
  name,
  antenna,
  tag,
  definition,
  it,
  children,
}: {
  readonly name: string;
  readonly antenna: number;
  readonly tag?: NfcTagStatus;
  readonly definition?: PhysicalCatalogEntry;
  readonly it: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-slmd border border-border bg-surface shadow-e1">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <Layers size={20} className="text-brand-blue" />
        <div className="flex-1">
          <h3 className="font-heading text-base font-semibold text-ink">{name}</h3>
          <p className="mt-1 text-xs text-ink-muted">
            {definition
              ? it
                ? (definition.nameIt ?? definition.name)
                : definition.name
              : tag
                ? it
                  ? "Modulo sconosciuto"
                  : "Unknown module"
                : it
                  ? "Nessun modulo rilevato"
                  : "No module detected"}
          </p>
        </div>
        <span
          className={`flex items-center gap-1.5 rounded-slpill px-2 py-1 text-[10px] ${tag ? "bg-brand-blue/10 text-brand-blue" : "bg-surface-sunken text-ink-faint"}`}
        >
          <Radio size={12} />
          NFC {antenna}
          {tag ? " · ✓" : ""}
        </span>
      </div>
      <div className="grid gap-3 p-4 2xl:grid-cols-2">{children}</div>
      {tag && (
        <div className="px-5 pb-3 font-mono text-[10px] text-ink-faint">
          {tag.registryId}:{tag.vendorId}:{tag.moduleTypeId} · UID{" "}
          {[...tag.uid]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase()}
        </div>
      )}
    </section>
  );
}

function PortTile({
  title,
  subtitle,
  pins,
  active,
  locked,
  onSelect,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly pins: readonly string[];
  readonly active: boolean;
  readonly locked: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`rounded-slmd border p-3 text-left transition-all ${active ? "border-brand-blue bg-brand-blue/5 shadow-e1" : "border-border hover:border-border-strong hover:bg-surface-raised"}`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        {title}
        {locked && <LockKeyhole size={12} className="text-ink-faint" />}
        <ChevronRight size={14} className="ml-auto text-ink-faint" />
      </div>
      <p className="mt-1 text-[11px] text-ink-muted">{subtitle}</p>
      <div className="mt-4 grid grid-cols-6 gap-1.5">
        {pins.map((pin, i) => (
          <div key={i} className="min-w-0 text-center">
            <span
              className={`mx-auto block h-3 w-3 rounded-full ${pin === "5V" ? "bg-brand-orange" : pin === "GND" ? "bg-ink-faint" : pin === "?" || pin === "NC" ? "bg-border-strong" : "bg-brand-blue"}`}
            />
            <span className="mt-1 block text-[9px] text-ink-faint">{i + 1}</span>
            <span title={pin} className="block truncate text-[9px] text-ink-muted">
              {pin}
            </span>
          </div>
        ))}
      </div>
    </button>
  );
}

function PinList({ pins }: { readonly pins: readonly string[] }) {
  return (
    <div className="space-y-2">
      {pins.map((pin, i) => (
        <div
          key={i}
          className="flex justify-between rounded-slmd border border-border px-3 py-2 text-sm"
        >
          <span>Pin {i + 1}</span>
          <span>{pin}</span>
          <LockKeyhole size={12} />
        </div>
      ))}
    </div>
  );
}

function CatalogDialog({
  entries,
  onClose,
  onImport,
}: {
  readonly entries: readonly PhysicalCatalogEntry[];
  readonly onClose: () => void;
  readonly onImport: (entries: readonly PhysicalCatalogEntry[]) => void;
}) {
  const { locale } = useLocale();
  const it = locale === "it";
  const [error, setError] = useState("");
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={motionTokens.duration.base}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-5"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="physical-catalog-title"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-slmd border border-border bg-surface p-6 shadow-e2"
      >
        <div className="flex items-center gap-3">
          <Layers size={22} className="text-brand-blue" />
          <h2
            id="physical-catalog-title"
            className="flex-1 font-heading text-xl font-bold text-ink"
          >
            {it ? "Catalogo moduli NFC" : "NFC module catalog"}
          </h2>
          <button
            aria-label={it ? "Chiudi catalogo" : "Close catalog"}
            onClick={onClose}
          >
            <X size={20} className="text-ink-muted" />
          </button>
        </div>
        <p className="my-4 text-sm leading-relaxed text-ink-muted">
          {it
            ? "Il catalogo si sincronizza con il server community. Il riconoscimento usa registro, produttore e tipo modulo. Un modulo senza pinout elettrico rimane configurabile manualmente sulla porta Function 2."
            : "The catalog synchronizes with the community server. Matching uses registry, vendor and module type. A module without electrical pinout remains manually configurable on Function port 2."}
        </p>
        <div className="space-y-3">
          {entries.map((entry) => (
            <div
              key={`${entry.registryId}:${entry.vendorId}:${entry.moduleTypeId}`}
              className="rounded-slmd border border-border p-4"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-semibold text-ink">
                  {it ? (entry.nameIt ?? entry.name) : entry.name}
                </span>
                <span
                  className={`rounded-slpill px-2 py-1 text-[10px] ${entry.modes ? "bg-success/10 text-success" : "bg-surface-sunken text-ink-muted"}`}
                >
                  {entry.modes
                    ? it
                      ? "Auto-configurabile"
                      : "Auto-configurable"
                    : it
                      ? "Definizione elettrica assente"
                      : "Electrical definition missing"}
                </span>
              </div>
              <p className="mt-2 font-mono text-xs text-ink-faint">
                {entry.registryId}:{entry.vendorId}:{entry.moduleTypeId}
              </p>
              {entry.pins && (
                <p className="mt-2 text-xs text-ink-muted">
                  {entry.pins.map((pin, i) => `${i + 1}: ${pin}`).join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
        <label className={`${secondary} mt-5 cursor-pointer`}>
          <Upload size={14} />
          {it ? "Importa definizioni JSON" : "Import JSON definitions"}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file
                .text()
                .then((raw) => {
                  onImport(parsePhysicalCatalog(raw));
                  setError("");
                })
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
                );
              event.target.value = "";
            }}
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-error">
            {error}
          </p>
        )}
      </section>
    </motion.div>
  );
}
