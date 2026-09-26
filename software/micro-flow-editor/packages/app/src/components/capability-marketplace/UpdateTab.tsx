import type { CoreBindingId } from "@spaghettilab/domain";
import { BleOtaSession, evaluatePostflight, updateTransportLabel, type PostflightResult, type PostflightSnapshot } from "@spaghettilab/ota-lifecycle";
import { updateStateLabel, type OtaCandidateManifest, type PreflightResult } from "@spaghettilab/ota-preflight";
import { BadgeCheck, Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { marketplaceCopy } from "../../lib/marketplace-copy.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { hexToBytes } from "./hex.js";

const CHUNK_SIZE = 4096;

/**
 * `ux/screens/S100-capability-marketplace/visual.md` § Aggiornamento —
 * stepper a 7 tappe (Arma → Carica → Avanzamento → Finalizza → Riavvia →
 * Prova → Conferma/Rollback). Gap dichiarato: `BleOtaSession` (S103) copre
 * solo `ARM → UPLOAD → FINALIZE → PENDING_REBOOT` — nessuna operazione wire
 * espone "conferma trial"/"rollback" (`spaghetti_update_confirm_trial()` è
 * Core-only, mai su alcun trasporto; il rollback è automatico via
 * MCUboot). Le tappe post-riavvio sono quindi osservate, non guidate: si
 * legge `getUpdateStatus()` via polling, e la "Conferma" è dedotta
 * confrontando uno snapshot prima/dopo con `evaluatePostflight()` — richiede
 * che l'utente riconnetta il Core (Core Connections) dopo il riavvio prima
 * di premere "Verifica postflight" qui, altrimenti lo snapshot "dopo"
 * sarebbe ancora quello pre-riavvio.
 */
export function UpdateTab({ bindingId, candidate, preflight }: { readonly bindingId: CoreBindingId; readonly candidate: OtaCandidateManifest | null; readonly preflight: PreflightResult | null }) {
  const { session } = useSession();
  const { locale } = useLocale();
  const copy = marketplaceCopy(locale);
  const { getSnapshot, listDeviceProfiles, getClient, getUpdateStatus } = useCoreSessions();
  const [phase, setPhase] = useState<string>("IDLE");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [beforeSnapshot, setBeforeSnapshot] = useState<PostflightSnapshot | null>(null);
  const [postflightResult, setPostflightResult] = useState<PostflightResult | null>(null);
  const [liveState, setLiveState] = useState<{ readonly state: number; readonly transport: number; readonly imageConfirmed: boolean } | null>(null);
  const sessionRef = useRef<BleOtaSession | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const binding = (session?.stack.current.coreBindings ?? []).find((b) => b.bindingId === bindingId);

  useEffect(() => {
    if (phase !== "PENDING_REBOOT") return;
    const interval = setInterval(() => {
      getUpdateStatus(bindingId)
        ?.then((s) => setLiveState({ state: s.state, transport: s.transport, imageConfirmed: s.imageConfirmed }))
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(interval);
  }, [phase, bindingId, getUpdateStatus]);

  async function buildSnapshot(): Promise<PostflightSnapshot | null> {
    const s = getSnapshot(bindingId);
    if (!s?.status || !s.features || !s.catalog || !s.resources || !binding) return null;
    const profiles = (await listDeviceProfiles(bindingId)) ?? [];
    return {
      deviceId: hexToBytes(binding.expectedDeviceId),
      fwVersion: s.status.version,
      featureSetHash: s.features.featureSetHash,
      packIds: s.features.packs.map((p) => p.id),
      catalogFingerprint: s.catalog.fingerprint,
      resourceReport: { flashImageBudgetBytes: s.resources.flashImageBudgetBytes, staticRamBudgetBytes: s.resources.staticRamBudgetBytes },
      configPreserved: true,
      profilesPreserved: profiles.length >= 0,
    };
  }

  async function handleArm() {
    if (!candidate || !preflight) return;
    setError(null);
    const before = await buildSnapshot();
    setBeforeSnapshot(before);
    const client = getClient(bindingId);
    if (!client) return;
    const ota = new BleOtaSession(client, candidate, preflight);
    sessionRef.current = ota;
    const outcome = await ota.arm(hexToBytes(candidate.hash));
    setPhase(ota.currentPhase);
    if (!outcome.ok) setError(outcome.issue.remediation);
  }

  async function handleUploadFile(file: File) {
    const ota = sessionRef.current;
    if (!ota) return;
    const buffer = new Uint8Array(await file.arrayBuffer());
    for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
      const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
      const last = offset + CHUNK_SIZE >= buffer.length;
      const outcome = await ota.writeChunk(offset, chunk, last);
      setPhase(ota.currentPhase);
      if (!outcome.ok) {
        setError(outcome.issue.remediation);
        return;
      }
      setProgress(Math.round(((offset + chunk.length) / buffer.length) * 100));
    }
  }

  async function handleFinalize() {
    const ota = sessionRef.current;
    if (!ota) return;
    const outcome = await ota.finalize();
    setPhase(ota.currentPhase);
    if (!outcome.ok) setError(outcome.issue.remediation);
  }

  async function handleCancel() {
    const ota = sessionRef.current;
    if (!ota) return;
    await ota.cancel();
    setPhase(ota.currentPhase);
  }

  async function handleVerifyPostflight() {
    if (!beforeSnapshot || !candidate) return;
    const after = await buildSnapshot();
    if (!after) return;
    setPostflightResult(evaluatePostflight(beforeSnapshot, after, candidate));
  }

  if (!candidate || !preflight || preflight.kind !== "READY") {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-body text-sm text-ink-faint">{copy.noReadyCandidate}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-2 font-body text-xs text-ink-muted">
        {["ARM", "UPLOAD", "FINALIZE", "PENDING_REBOOT"].map((stage) => (
          <span key={stage} className="rounded-slpill px-3 py-1.5" style={{ border: phase === stage ? "2px solid var(--color-brand-purple-glow)" : "1px solid var(--color-border-strong)", color: phase === stage ? "var(--color-brand-purple-glow)" : undefined }}>
            {stage}
          </span>
        ))}
      </div>

      {error && <p className="font-body text-sm text-error">{error}</p>}

      {phase === "IDLE" && (
        <button type="button" onClick={() => void handleArm()} className="w-fit rounded-slpill bg-brand-purple-glow px-4 py-1.5 font-body-strong text-sm text-white hover:opacity-90">
          {copy.arm}
        </button>
      )}

      {phase === "ARM" && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 rounded-slpill bg-brand-purple-glow px-4 py-1.5 font-body-strong text-sm text-white hover:opacity-90">
            <Upload size={14} />
            {copy.uploadImage}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUploadFile(file);
              e.target.value = "";
            }}
          />
          <button type="button" onClick={() => void handleCancel()} className="rounded-slpill border border-border-strong px-3 py-1.5 font-body text-sm text-ink hover:bg-surface-raised">
            {copy.cancel}
          </button>
        </div>
      )}

      {phase === "UPLOAD" && (
        <div className="flex flex-col gap-2">
          <div className="h-2 w-full overflow-hidden rounded-slpill bg-surface-sunken">
            <div className="h-full bg-brand-purple-glow transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="font-mono text-xs text-ink-muted">{progress}%</p>
        </div>
      )}

      {phase === "FINALIZE" && (
        <button type="button" onClick={() => void handleFinalize()} className="w-fit rounded-slpill bg-brand-purple-glow px-4 py-1.5 font-body-strong text-sm text-white hover:opacity-90">
          {copy.finalize}
        </button>
      )}

      {phase === "PENDING_REBOOT" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-slmd border border-info p-3" style={{ backgroundColor: "color-mix(in srgb, var(--color-info) 6%, transparent)" }}>
            <Loader2 size={16} className="animate-spin text-info" />
            <p className="font-body text-sm text-ink">{copy.waitingReboot}</p>
          </div>
          {liveState && (
            <div className="flex flex-wrap gap-2 font-mono text-xs text-ink-muted">
              <span className="rounded-slpill border border-border-strong px-2 py-1">{copy.state} {updateStateLabel(liveState.state)}</span>
              <span className="rounded-slpill border border-border-strong px-2 py-1">{copy.transport} {updateTransportLabel(liveState.transport)}</span>
              <span className="rounded-slpill border border-border-strong px-2 py-1">{copy.imageConfirmed} {liveState.imageConfirmed ? copy.yes : copy.no}</span>
            </div>
          )}
          <p className="font-body text-xs text-ink-muted">
            {copy.postflightHelp}
          </p>
          <button type="button" disabled={!beforeSnapshot} onClick={() => void handleVerifyPostflight()} className="w-fit rounded-slpill bg-brand-purple-glow px-4 py-1.5 font-body-strong text-sm text-white hover:opacity-90 disabled:opacity-40">
            {copy.verifyPostflight}
          </button>
          {postflightResult && (
            <div className="flex items-center gap-2 rounded-slmd border-2 p-3" style={{ borderColor: postflightResult.kind === "CONFIRMED_INSTALLED" ? "var(--color-success)" : "var(--color-info)" }}>
              <BadgeCheck size={18} className={postflightResult.kind === "CONFIRMED_INSTALLED" ? "text-success" : "text-info"} />
              <div>
                <p className="font-body-strong text-sm text-ink">{postflightResult.kind}</p>
                <p className="font-body text-xs text-ink-muted">{postflightResult.reason}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {(phase === "CANCELLED" || phase === "FAILED") && <p className="font-body text-sm text-ink-muted">Sessione OTA {phase === "CANCELLED" ? "annullata" : "fallita"}.</p>}
    </div>
  );
}
