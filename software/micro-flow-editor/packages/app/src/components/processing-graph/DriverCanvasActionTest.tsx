import { useState } from "react";
import type { SensorRecipe } from "../../lib/sensor-recipe.js";
import {
  runRecipeHardwareTest,
  type RecipeHardwareTestResult,
} from "../../lib/recipe-hardware-test.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";

/** Manual action test from the canvas uses the same real bus path as the driver editor. */
export function DriverCanvasActionTest({
  recipe,
  preferredBindingId,
}: {
  recipe: SensorRecipe;
  preferredBindingId?: string;
}) {
  const { rows, getClient, installProfile, listDeviceProfiles, removeProfile } =
    useCoreSessions();
  const { locale } = useLocale();
  const it = locale === "it";
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [withInit, setWithInit] = useState(false);
  const [result, setResult] = useState<RecipeHardwareTestResult | null>(null);
  const draft = recipe.deviceDraft;
  if (!draft || draft.binding.bus !== "i2c" || !recipe.actionId) return null;
  async function run() {
    if (running || !draft) return;
    setRunning(true);
    setResult(null);
    setFailure(null);
    try {
      const ready = rows.filter((r) => r.sessionState === "READY");
      const bindingId =
        ready.find((r) => r.binding.bindingId === preferredBindingId)?.binding
          .bindingId ?? (ready.length === 1 ? ready[0]?.binding.bindingId : undefined);
      const output = await runRecipeHardwareTest({
        client: bindingId ? getClient(bindingId) : undefined,
        draft,
        selection: {
          target: { kind: "action", commandId: recipe.actionId },
          runInitFirst: withInit,
        },
        labels: {
          init: it ? "Inizializzazione" : "Initialization",
          task: it ? "Azione" : "Action",
          action: it ? "Azione" : "Action",
        },
        i2cAddress: Number.parseInt(
          (draft.binding.i2c?.address ?? "").replace(/^0x/i, ""),
          16,
        ),
        installProfile: bindingId
          ? async (profile) => {
              const installed = await installProfile(bindingId, profile);
              return installed?.ok
                ? { ok: true }
                : {
                    ok: false,
                    error:
                      installed && !installed.ok
                        ? installed.error.remediation
                        : "Installazione non disponibile",
                  };
            }
          : undefined,
        cleanupTryProfiles: bindingId
          ? async () => {
              const profiles = await listDeviceProfiles(bindingId);
              for (const profile of profiles ?? []) {
                if (profile.profileId.startsWith("try."))
                  await removeProfile(bindingId, profile.profileId, profile.version, {
                    isReferencedLocally: false,
                  });
              }
            }
          : undefined,
      });
      setResult(output);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }
  return (
    <section className="mb-3 rounded-slmd border border-border-strong p-3">
      <h3 className="mb-2 font-body text-xs font-semibold text-ink">
        {it ? "Prova azione sul dispositivo" : "Test action on device"}
      </h3>
      <label className="mb-2 flex items-center gap-2 font-body text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={withInit}
          disabled={running}
          onChange={(e) => setWithInit(e.target.checked)}
        />
        {it ? "Esegui prima l’inizializzazione" : "Run initialization first"}
      </label>
      <button
        type="button"
        disabled={running}
        onClick={() => void run()}
        className="rounded-slpill border border-border-strong px-3 py-1.5 font-body text-xs text-ink disabled:opacity-40"
      >
        {running
          ? it
            ? "Prova in corso…"
            : "Testing…"
          : it
            ? "Testa questo blocco"
            : "Test this block"}
      </button>
      {failure && (
        <p role="alert" className="mt-2 font-body text-xs text-error">
          {failure}
        </p>
      )}
      {result && (
        <div className="mt-2 space-y-1 font-body text-xs text-ink" aria-live="polite">
          <p>{result.ok ? "OK" : (result.error ?? result.note)}</p>
          {Object.entries(result.capture.rxByOpId).map(([id, bytes]) => (
            <p key={id} className="font-mono">
              RX:{" "}
              {bytes
                .map((b) =>
                  b === null
                    ? "—"
                    : `0x${b.toString(16).padStart(2, "0").toUpperCase()}`,
                )
                .join(" ")}
            </p>
          ))}
          {result.readResults?.map((value, i) => (
            <p key={`${value.id}-${i}`}>
              {value.label}: {value.value ?? "—"} {value.unit}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
