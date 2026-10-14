import { PhysicalInterfaceEditor } from "./PhysicalInterfaceEditor.js";
import { addConfirmedPinModules } from "../../lib/physical-pin-bindings.js";
import { useCommunityHub } from "../../state/community-hub-context.js";
import { hubCatalog } from "../../lib/community-hub.js";
import {
  type GetStatusResponse,
  type PhysicalBackbone,
  DEFAULT_PHYSICAL_SETTINGS,
  ProtocolStatus,
  SpaghettiClientError,
} from "@spaghettilab/protocol-sdk";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Cable,
  Check,
  Cpu,
  Layers,
  LoaderCircle,
  Radio,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_FUNCTION_VARIANT,
  PHYSICAL_CAP,
  PHYSICAL_CATALOG,
  PHYSICAL_META_KEY,
  catalogEntry,
  defaultModesForVariant,
  expectedFunctionTag,
  functionVariantOf,
  modesForVariant,
  parsePhysicalCatalog,
  parsePhysicalProject,
  pinsForModes,
  tagForSlot,
  topologyForBoard,
  validatePhysicalModes,
  type BackbonePhysicalDraft,
  type FunctionModuleVariant,
  type PhysicalCatalogEntry,
  type PhysicalProject,
} from "../../lib/backbone-physical.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import {
  attachedFromStatus,
  useCoreSessions,
  type AttachedBackbone,
} from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { CoreSelector } from "../catalog-topology/CoreSelector.js";

/** Offline authoring when firmware has not reported Module Function layout yet. */
const AUTHORING_CAPABILITIES =
  PHYSICAL_CAP.I2C |
  PHYSICAL_CAP.SPI |
  PHYSICAL_CAP.UART |
  PHYSICAL_CAP.DIGITAL_INPUT |
  PHYSICAL_CAP.DIGITAL_OUTPUT |
  PHYSICAL_CAP.ADC |
  PHYSICAL_CAP.W1 |
  PHYSICAL_CAP.PWM;

/** Map protocol / transport failures to user-facing Configure messages. */
function formatConfigureError(error: unknown, it: boolean, backboneId?: string): string {
  const id = backboneId ? ` ${backboneId}` : "";
  if (error instanceof SpaghettiClientError) {
    if (error.code === "TIMEOUT") {
      return it
        ? `Configurazione non riuscita: Backbone${id} non risponde`
        : `Configuration failed: Backbone${id} not responding`;
    }
    if (error.code === "CANCELLED") {
      return it
        ? "Configurazione annullata"
        : "Configuration cancelled";
    }
    switch (error.status) {
      case ProtocolStatus.UNAUTHORIZED:
        return it
          ? "Configurazione non riuscita: la porta è controllata automaticamente dal modulo NFC"
          : "Configuration failed: port is automatically controlled by an NFC module";
      case ProtocolStatus.CONFLICT:
        return it
          ? "Configurazione non riuscita: tag NFC non corrisponde allo stato attuale"
          : "Configuration failed: NFC tag does not match current device state";
      case ProtocolStatus.INVALID_ARGUMENT:
      case ProtocolStatus.MALFORMED_REQUEST:
        return it
          ? "Configurazione non riuscita: mappatura pin non valida"
          : "Configuration failed: invalid pin mapping";
      case ProtocolStatus.UNSUPPORTED:
        return it
          ? "Configurazione non riuscita: interfaccia o pin non supportati"
          : "Configuration failed: unsupported interface or pin";
      case ProtocolStatus.BUSY:
        return it
          ? "Configurazione non riuscita: porta occupata"
          : "Configuration failed: port is busy";
      case ProtocolStatus.UNAVAILABLE:
      case ProtocolStatus.TIMEOUT:
        return it
          ? `Configurazione non riuscita: Backbone${id} non risponde`
          : `Configuration failed: Backbone${id} not responding`;
      default:
        return it
          ? `Configurazione non riuscita: ${ProtocolStatus[error.status ?? -1] ?? error.message}`
          : `Configuration failed: ${ProtocolStatus[error.status ?? -1] ?? error.message}`;
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return it
    ? "Configurazione non riuscita"
    : "Configuration failed";
}

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
  const { rows, getSnapshot, getClient, observeStatus } = useCoreSessions();
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
            Module Function
          </h1>
          <p className="mt-1 font-body text-xs text-ink-muted">
            {it
              ? "Trascina i segnali delle periferiche sui pin del modulo"
              : "Drag peripheral signals onto the module pins"}
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {boards.length > 1 && (
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-5 py-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                Backbone
              </span>
              <select
                className={`${control} max-w-xs`}
                value={board?.deviceIdHex ?? ""}
                onChange={(event) => setBoardId(event.target.value)}
              >
                {boards.map((item, index) => (
                  <option key={item.deviceIdHex || item.nodeId} value={item.deviceIdHex}>
                    {`Backbone ${index + 1}${item.local ? " · Master" : ""}`}
                  </option>
                ))}
              </select>
            </div>
          )}
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
                /* Use the live session status when present. A redundant
                 * getStatus→APPLY_PHYSICAL pair on USB-Serial/JTAG used to
                 * overflow the 4 KiB USB worker during STATUS and drop APPLY. */
                let fresh = status;
                if (!fresh) {
                  try {
                    fresh = await client.getStatus();
                    observeStatus(selected.bindingId, fresh);
                  } catch {
                    /* Fall through to the availability check below. */
                  }
                }
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
                const backboneLabel = currentBoard.local
                  ? "Master"
                  : `0x${currentBoard.nodeId.toString(16)}`;
                try {
                  await client.applyPhysical({
                    nodeId: currentBoard.local ? 0 : currentBoard.nodeId,
                    modes: new Uint8Array(draft.modes),
                    i2cSpeed: draft.i2cSpeed,
                    settings:
                      topology?.version === 2
                        ? (draft.settings ?? DEFAULT_PHYSICAL_SETTINGS)
                        : undefined,
                    expectedTag: expectedFunctionTag(
                      tagForSlot(fresh, currentBoard, 2),
                      draft.automatic,
                    ),
                  });
                } catch (error) {
                  throw new Error(
                    formatConfigureError(error, it, backboneLabel),
                  );
                }
                /* APPLY_PHYSICAL ACK is authoritative; refresh status for UI. */
                let next = fresh;
                try {
                  next = await client.getStatus();
                  observeStatus(selected.bindingId, next);
                } catch {
                  /* Keep last known status — apply already succeeded. */
                }
                const actual = topologyForBoard(next, currentBoard);
                const confirmed = {
                  ...draft,
                  settings: actual?.settings ?? draft.settings,
                  applied: true,
                  nodeId: currentBoard.nodeId,
                  local: currentBoard.local,
                  backendPortId: actual?.backendPortId,
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
  const [draft, setDraft] = useState<BackbonePhysicalDraft>(() => {
    if (saved) {
      const variant = functionVariantOf(saved);
      return { ...saved, variant, modes: modesForVariant(saved.modes, variant) };
    }
    // Prefer V1 when the live board already reports a 4-signal map.
    const variant =
      topology?.modes?.length === 4 ? ("v1" as const) : DEFAULT_FUNCTION_VARIANT;
    // Authoring starts empty (all NC). Device topology modes are live state,
    // not a draft seed — otherwise GPIO often appears "already configured".
    return {
      name: "",
      variant,
      modes: defaultModesForVariant(variant),
      i2cSpeed: topology?.i2cSpeed ?? 0,
      settings: topology?.settings ?? DEFAULT_PHYSICAL_SETTINGS,
    };
  });
  const [seeded, setSeeded] = useState(!!topology || !!saved);
  if (!seeded && topology) {
    setSeeded(true);
    const variant =
      topology.modes?.length === 4 ? ("v1" as const) : DEFAULT_FUNCTION_VARIANT;
    setDraft((prev) => {
      // Keep an explicit saved/user variant; only adopt V1 from a 4-pin board
      // when the draft was still the default empty V2 shell.
      const keepVariant =
        prev.variant === "v1" ||
        (prev.variant === "v2" && prev.modes.some((mode) => (mode & 15) !== 0))
          ? functionVariantOf(prev)
          : variant;
      return {
        ...prev,
        variant: keepVariant,
        modes: modesForVariant(prev.modes, keepVariant),
        // Keep empty / user modes; only sync speed + settings from the board.
        i2cSpeed: topology.i2cSpeed,
        settings: topology.settings ?? DEFAULT_PHYSICAL_SETTINGS,
      };
    });
  }
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const functionTag = tagForSlot(status, board, 2);
  const functionDefinition = catalogEntry(functionTag, catalog);
  const localAutomatic =
    !!functionDefinition?.modes &&
    !validatePhysicalModes(functionDefinition.modes, functionDefinition.i2cSpeed ?? 0);
  const automatic = localAutomatic || (topology?.source === 2 && !!functionTag);
  const effective: BackbonePhysicalDraft = localAutomatic
    ? {
        name: functionDefinition!.name,
        variant: functionVariantOf({
          modes: functionDefinition!.modes!,
          variant: draft.variant,
        }),
        modes: functionDefinition!.modes!,
        i2cSpeed: functionDefinition!.i2cSpeed ?? 0,
        protocol: functionDefinition!.protocol,
        settings: functionDefinition!.settings ?? DEFAULT_PHYSICAL_SETTINGS,
        automatic: true,
      }
    : automatic
      ? {
          name: functionDefinition?.name ?? "NFC module",
          variant: functionVariantOf({ modes: topology!.modes, variant: draft.variant }),
          modes: topology!.modes,
          i2cSpeed: topology!.i2cSpeed,
          settings: topology!.settings,
          automatic: true,
        }
      : draft;
  const variant = functionVariantOf(effective);

  function setVariant(next: FunctionModuleVariant) {
    if (automatic || busy) return;
    setDraft({
      ...draft,
      variant: next,
      modes: modesForVariant(draft.modes, next),
      applied: false,
    });
  }
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
            text: formatConfigureError(
              error,
              it,
              board.local ? "Master" : `0x${board.nodeId.toString(16)}`,
            ),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [autoKey, autoModes, autoSpeed, autoSettings, ready, topology, it]);

  async function apply() {
    if (busy) return;
    const invalid = validatePhysicalModes(effective.modes, effective.i2cSpeed);
    if (invalid) {
      setResult({ ok: false, text: invalid });
      return;
    }
    setBusy(true);
    setResult(null);
    const backboneLabel = board.local
      ? "Master"
      : `0x${board.nodeId.toString(16)}`;
    try {
      await onApply(effective);
      setResult({
        ok: true,
        text: it
          ? `Configurazione applicata (${backboneLabel})`
          : `Configuration applied (${backboneLabel})`,
      });
    } catch (error) {
      setResult({
        ok: false,
        text: formatConfigureError(error, it, backboneLabel),
      });
    } finally {
      setBusy(false);
    }
  }

  const knownLayout = topology?.layout === 1;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-3 px-5 pt-5 lg:px-8">
        <span className="flex h-10 w-10 items-center justify-center rounded-slmd bg-brand-blue/10 text-brand-blue">
          <Cpu size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-lg font-bold text-ink">
              {it ? "Module Function" : "Module Function"}
            </h2>
            <span
              className={`rounded-slpill px-2.5 py-0.5 text-[10px] font-semibold ${ready ? "bg-success/10 text-success" : "bg-surface text-ink-faint"}`}
            >
              {ready ? (it ? "Connessa" : "Connected") : it ? "Non connessa" : "Disconnected"}
            </span>
            {functionTag && (
              <span className="inline-flex items-center gap-1 rounded-slpill bg-brand-blue/10 px-2 py-0.5 text-[10px] text-brand-blue">
                <Radio size={10} /> NFC
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">
            {functionDefinition
              ? it
                ? (functionDefinition.nameIt ?? functionDefinition.name)
                : functionDefinition.name
              : it
                ? "Configura il connettore fisico della Backbone"
                : "Configure the Backbone physical connector"}
            {topology?.mcu ? ` · ${topology.mcu}` : ""}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          {it ? "Versione" : "Version"}
          <select
            className={`${control} w-auto min-w-[8.5rem]`}
            value={variant}
            disabled={!!automatic || busy}
            onChange={(event) => setVariant(event.target.value as FunctionModuleVariant)}
          >
            <option value="v2">V2 · 12 pin</option>
            <option value="v1">V1 · 6 pin</option>
          </select>
        </label>
      </div>

      <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={motionTokens.duration.base}
          className="mx-auto flex w-full max-w-[1440px] min-h-0 flex-1 flex-col gap-4 px-5 py-4 lg:px-8"
        >
          {!knownLayout && (
            <div className="rounded-slmd border border-border bg-surface px-4 py-3 text-xs text-ink-muted">
              {it
                ? "Topologia non ancora ricevuta dal firmware: puoi configurare in locale; l’applicazione sulla Backbone richiede la connessione."
                : "Topology not yet reported by firmware: you can configure locally; applying to the Backbone requires a connection."}
            </div>
          )}
          <PhysicalInterfaceEditor
            draft={effective}
            capabilities={topology?.capabilities ?? AUTHORING_CAPABILITIES}
            extended={topology?.version === 2 || !topology}
            disabled={!!automatic || busy}
            automatic={!!automatic}
            onChange={(next) =>
              setDraft({
                ...next,
                variant: functionVariantOf(next),
                applied: false,
              })
            }
          />

          {result && (
            <p
              role="status"
              className={`rounded-slmd p-3 text-xs ${result.ok ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}
            >
              {result.text}
            </p>
          )}

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            {(() => {
              const modeError = validatePhysicalModes(effective.modes, effective.i2cSpeed);
              const configureBlockedReason = !ready
                ? it
                  ? "Collega la Backbone (stato Connessa) per applicare la configurazione."
                  : "Connect the Backbone (Connected status) to apply the configuration."
                : modeError
                  ? modeError
                  : busy
                    ? it
                      ? "Configurazione in corso…"
                      : "Configuration in progress…"
                    : null;
              return (
                <>
                  {configureBlockedReason ? (
                    <p className="rounded-slsm bg-warning/15 px-2.5 py-1.5 font-body text-[11px] text-ink">
                      {configureBlockedReason}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
            <button
              className={action}
              disabled={Boolean(configureBlockedReason)}
              title={configureBlockedReason ?? undefined}
              onClick={() => void apply()}
            >
              {busy ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <Check size={16} />
              )}
              {automatic
                ? it
                  ? "Riapplica NFC"
                  : "Reapply NFC"
                : it
                  ? "Configura"
                  : "Configure"}
            </button>
            {!automatic && (
              <button
                className={secondary}
                disabled={busy}
                onClick={() => {
                  onSave(draft);
                  setResult({
                    ok: true,
                    text: it ? "Bozza salvata." : "Draft saved.",
                  });
                }}
              >
                {it ? "Salva bozza" : "Save draft"}
              </button>
            )}
            {functionTag && !automatic && (
              <button
                className={secondary}
                disabled={!draft.name.trim() || busy}
                onClick={() => {
                  onRegister({
                    registryId: functionTag.registryId ?? 0,
                    vendorId: functionTag.vendorId ?? 0,
                    moduleTypeId: functionTag.moduleTypeId ?? 0,
                    name: draft.name || "Module Function",
                    pins: pinsForModes(draft.modes, functionVariantOf(draft)),
                    modes: draft.modes,
                    i2cSpeed: draft.i2cSpeed,
                    settings: draft.settings,
                    protocol: draft.protocol,
                  });
                  setResult({
                    ok: true,
                    text: it
                      ? "Definizione aggiunta al catalogo."
                      : "Definition added to catalog.",
                  });
                }}
              >
                {it ? "Catalogo NFC" : "NFC catalog"}
              </button>
            )}
                  </div>
                </>
              );
            })()}
          </div>
        </motion.div>
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
            ? "Il catalogo si sincronizza con il server community. Il riconoscimento usa registro, produttore e tipo modulo. Un modulo senza pinout elettrico rimane configurabile manualmente sul Module Function."
            : "The catalog synchronizes with the community server. Matching uses registry, vendor and module type. A module without electrical pinout remains manually configurable on Module Function."}
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
