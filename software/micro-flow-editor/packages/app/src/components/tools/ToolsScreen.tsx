import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  Monitor,
  Wrench,
  Save,
  Plus,
  Trash2,
  Play,
  Square,
  Pencil,
  SlidersHorizontal,
  ArrowRight,
} from "lucide-react";
import { useSession, saveOpenProject } from "../../state/session-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import {
  savedDeviceDrivers,
  saveDriverMetadata,
} from "../../lib/device-driver-library.js";
import {
  DEVICE_RECIPE_DRAFT_META_KEY,
  effectiveActionSteps,
  recipeVariables,
  serializeDeviceRecipeDraft,
} from "../../lib/device-recipe-draft.js";
import { compileRuntimeDriver } from "../../lib/driver-runtime-profile.js";
import {
  DISPLAY_TOOLS_META_KEY,
  DISPLAY_FUNCTIONS,
  DISPLAY_FUNCTION_LABELS,
  createDisplayTool,
  parseDisplayTools,
  rasterDisplay,
  compileDisplayProgram,
  displayFunctionInputs,
  displayProgramAction,
  type DisplayToolProject,
  type DisplayFunction,
  type DisplayElement,
  type DisplayAdapterCall,
  type AdapterInput,
} from "../../lib/display-tool.js";
import {
  runDisplayProgram,
  type DisplayHardwareResult,
} from "../../lib/display-tool-runtime.js";
import {
  draftForBinding,
  parsePhysicalProject,
  PHYSICAL_META_KEY,
} from "../../lib/backbone-physical.js";
import type { DeviceRecipeDraft } from "../../lib/device-recipe-draft.js";

const EMPTY_METADATA: import("@spaghettilab/domain").ProjectV1["authoringMetadata"] =
  Object.freeze({});
const field =
  "w-full min-w-0 rounded-lg border border-border-strong bg-surface px-2 py-1.5 font-body text-xs text-ink outline-none focus:border-brand-blue";
const button =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-2 font-body text-xs text-ink hover:border-brand-blue disabled:opacity-40";
const panel = "rounded-slmd border border-border-strong bg-surface p-4";
const newCall = (): DisplayAdapterCall => ({
  id: crypto.randomUUID(),
  actionId: "",
  inputs: [],
  outputs: [],
  repeat: "once",
  chunkSize: 8,
});

export function ToolsScreen() {
  const { session, execute, navigate } = useSession();
  const { rows, getClient, installProfile, removeProfile } = useCoreSessions();
  const metadata = session?.stack.current.authoringMetadata ?? EMPTY_METADATA;
  const drivers = useMemo(() => savedDeviceDrivers(metadata), [metadata]);
  const saved = useMemo(
    () => parseDisplayTools(metadata[DISPLAY_TOOLS_META_KEY]?.comment),
    [metadata],
  );
  const [project, setProject] = useState<DisplayToolProject>(
    () => saved[0] ?? createDisplayTool(),
  );
  const [tab, setTab] = useState<"design" | "adapter">("design");
  const [kind, setKind] = useState<Exclude<DisplayFunction, "flush" | "clear">>("line");
  const [functionId, setFunctionId] = useState<DisplayFunction>("line");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [withInit, setWithInit] = useState(true);
  const [results, setResults] = useState<readonly DisplayHardwareResult[]>([]);
  const abort = useRef<AbortController | null>(null);
  const drag = useRef<string | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const driver = drivers.find((driver) => driver.id === project.driverId);
  const selected = project.elements.find((element) => element.id === selectedId);
  const drawing = useMemo(() => {
    try {
      const pixels = rasterDisplay(project);
      const path: string[] = [];
      pixels.forEach((pixel, index) => {
        if (pixel)
          path.push(
            `M${index % project.width} ${Math.floor(index / project.width)}h1v1h-1z`,
          );
      });
      return { path: path.join(""), error: null };
    } catch (error) {
      return {
        path: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [project]);
  const compiled = useMemo(() => {
    if (!driver)
      return {
        calls: [],
        error: "Seleziona un driver salvato nella scheda Driver e adapter.",
      };
    try {
      return { calls: compileDisplayProgram(project, driver), error: null };
    } catch (error) {
      return {
        calls: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [project, driver]);
  function patch(next: Partial<DisplayToolProject>) {
    setProject((current) => ({ ...current, ...next }));
    setMessage(null);
    setFailure(null);
  }
  function patchElement(id: string, next: Partial<DisplayElement>) {
    setProject((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        element.id === id ? { ...element, ...next } : element,
      ),
    }));
  }
  function patchCall(id: string, next: Partial<DisplayAdapterCall>) {
    patch({
      adapter: {
        ...project.adapter,
        [functionId]: (project.adapter[functionId] ?? []).map((call) =>
          call.id === id ? { ...call, ...next } : call,
        ),
      },
    });
  }
  function point(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          project.width - 1,
          Math.floor(((event.clientX - bounds.left) / bounds.width) * project.width),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          project.height - 1,
          Math.floor(((event.clientY - bounds.top) / bounds.height) * project.height),
        ),
      ),
    };
  }
  function startDrawing(event: PointerEvent<SVGSVGElement>) {
    if (running) return;
    const { x, y } = point(event),
      id = crypto.randomUUID();
    patch({
      elements: [
        ...project.elements,
        {
          id,
          kind,
          x1: x,
          y1: y,
          x2: x,
          y2: y,
          color: 1,
          text: kind === "text" ? "TESTO" : "",
          filled: false,
        },
      ],
    });
    setSelectedId(id);
    if (kind !== "text" && kind !== "pixel") {
      drag.current = id;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function updateDrawing(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current || running) return;
    const { x, y } = point(event);
    patchElement(drag.current, { x2: x, y2: y });
  }
  async function save() {
    if (!execute || !session) return;
    setFailure(null);
    const next = [...saved.filter((item) => item.id !== project.id), project];
    const result = execute({
      kind: "SaveDisplayTool",
      apply: (source) => ({
        ok: true,
        value: {
          ...source,
          authoringMetadata: {
            ...source.authoringMetadata,
            [DISPLAY_TOOLS_META_KEY]: { comment: JSON.stringify(next) },
          },
        },
      }),
    });
    if (!result.ok) {
      setFailure("Impossibile salvare il tool.");
      return;
    }
    try {
      await saveOpenProject(session);
      setMessage("Disegno e adapter salvati nel progetto.");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }
  function generateAction() {
    if (!driver || !execute) return;
    setFailure(null);
    try {
      const action = displayProgramAction(project, driver);
      const next: DeviceRecipeDraft = {
        ...driver,
        category: "sensor",
        commands: [
          ...driver.commands.filter((existing) => existing.id !== action.id),
          action,
        ],
        updatedAt: Date.now(),
      };
      compileRuntimeDriver({
        ...next,
        flowInterfaces: [],
        commands: next.commands.map((command) => ({
          ...command,
          steps: effectiveActionSteps(next, command),
        })),
      });
      execute({
        kind: "GenerateDisplayProgramAction",
        apply: (source) => ({
          ok: true,
          value: {
            ...source,
            authoringMetadata: {
              ...saveDriverMetadata(source.authoringMetadata, next),
              [DEVICE_RECIPE_DRAFT_META_KEY]: {
                comment: serializeDeviceRecipeDraft(next),
              },
              [DISPLAY_TOOLS_META_KEY]: {
                comment: JSON.stringify([
                  ...saved.filter((item) => item.id !== project.id),
                  project,
                ]),
              },
            },
          },
        }),
      });
      navigate("device-recipe-editor");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }
  async function run() {
    if (!driver || running) return;
    const preferred = session?.stack.current.coreBindings[0]?.bindingId;
    const ready = rows.filter((row) => row.sessionState === "READY");
    const binding =
      ready.find((row) => row.binding.bindingId === preferred)?.binding.bindingId ??
      (ready.length === 1 ? ready[0]?.binding.bindingId : undefined);
    const client = binding ? getClient(binding) : undefined;
    if (!binding || !client) {
      setFailure("Collega il Core del display in Discover prima della prova.");
      return;
    }
    if (compiled.error) {
      setFailure(compiled.error);
      return;
    }
    setRunning(true);
    setFailure(null);
    setResults([]);
    setMessage("Preparazione del display…");
    const controller = new AbortController();
    abort.current = controller;
    try {
      await runDisplayProgram({
        client,
        driver,
        calls: compiled.calls,
        withInit,
        signal: controller.signal,
        physical: draftForBinding(
          parsePhysicalProject(metadata[PHYSICAL_META_KEY]?.comment),
          binding,
        ),
        installProfile: async (profile) => {
          const result = await installProfile(binding, profile);
          if (!result?.ok)
            throw new Error(
              result && !result.ok
                ? result.error.remediation
                : "Installazione non disponibile.",
            );
        },
        removeProfile: async (id, version) => {
          const result = await removeProfile(binding, id, version, {
            isReferencedLocally: false,
          });
          if (!result?.ok)
            throw new Error(
              result && !result.ok
                ? result.error.remediation
                : "Rimozione del profilo temporaneo non disponibile.",
            );
        },
        onProgress: (completed, total, result) => {
          setMessage(`Invio al display: ${completed} / ${total}`);
          if (Object.keys(result.values).length || result.reads.length)
            setResults((current) => [...current, result]);
        },
      });
      setMessage(
        "Programma inviato al display. Configurazione precedente ripristinata.",
      );
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setMessage(null);
    } finally {
      abort.current = null;
      setRunning(false);
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-sunken">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-4">
        <Wrench size={22} className="text-brand-blue" />
        <h1 className="font-heading text-xl font-bold text-ink">Tool</h1>
        <span className="inline-flex items-center gap-2 rounded-full bg-brand-blue/10 px-3 py-1 font-body text-sm text-brand-blue">
          <Monitor size={16} />
          Display
        </span>
        <p className="font-body text-xs text-ink-muted">
          Disegno grafico, driver esistente, adapter manuale.
        </p>
        <button
          className={`${button} ml-auto`}
          disabled={running || !session}
          onClick={() => void save()}
        >
          <Save size={14} />
          Salva tool
        </button>
      </header>
      {!session ? (
        <p className="p-6 font-body text-sm text-ink-muted">
          Apri un progetto per usare i tool.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-3">
            <select
              aria-label="Programma display salvato"
              className={`${field} max-w-52`}
              value={saved.some((item) => item.id === project.id) ? project.id : ""}
              disabled={running}
              onChange={(event) => {
                const found = saved.find((item) => item.id === event.target.value);
                if (found) {
                  setProject(found);
                  setSelectedId(null);
                  setResults([]);
                  setMessage(null);
                  setFailure(null);
                }
              }}
            >
              <option value="">Programma non salvato</option>
              {saved.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Nome programma display"
              className={`${field} max-w-52`}
              value={project.name}
              disabled={running}
              onChange={(event) => patch({ name: event.target.value })}
            />
            <button
              className={button}
              disabled={running}
              onClick={() => {
                setProject({
                  ...createDisplayTool(),
                  driverId: project.driverId,
                  adapter: project.adapter,
                });
                setSelectedId(null);
                setResults([]);
                setMessage(null);
                setFailure(null);
              }}
            >
              <Plus size={13} />
              Nuovo disegno
            </button>
            <div className="ml-auto flex rounded-full border border-border-strong p-0.5">
              <button
                className={`rounded-full px-4 py-1.5 font-body text-xs ${tab === "design" ? "bg-brand-blue text-white" : "text-ink-muted"}`}
                onClick={() => setTab("design")}
              >
                <Pencil size={13} className="mr-1 inline" />
                Disegno
              </button>
              <button
                className={`rounded-full px-4 py-1.5 font-body text-xs ${tab === "adapter" ? "bg-brand-blue text-white" : "text-ink-muted"}`}
                onClick={() => setTab("adapter")}
              >
                <SlidersHorizontal size={13} className="mr-1 inline" />
                Driver e adapter
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {failure && (
              <p
                role="alert"
                className="mb-3 rounded-lg border border-error/30 bg-error/5 p-3 font-body text-xs text-error"
              >
                {failure}
              </p>
            )}
            {message && (
              <p
                role="status"
                className="mb-3 rounded-lg bg-brand-blue/10 p-3 font-body text-xs text-ink"
              >
                {message}
              </p>
            )}
            {tab === "adapter" ? (
              <div className="mx-auto max-w-6xl space-y-4">
                <section className={panel}>
                  <h2 className="mb-3 font-body text-sm font-semibold text-ink">
                    Driver del display
                  </h2>
                  <select
                    aria-label="Driver del display"
                    value={project.driverId}
                    disabled={running}
                    className={field}
                    onChange={(event) => patch({ driverId: event.target.value })}
                  >
                    <option value="">Seleziona un driver creato in Dispositivi</option>
                    {drivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.name} · {driver.binding.bus.toUpperCase()}{" "}
                        {driver.binding.i2c?.address ?? ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 font-body text-xs text-ink-muted">
                    {driver
                      ? `${driver.commands.length} azioni disponibili. Le associazioni usano gli ID di azioni e variabili; i nomi possono cambiare.`
                      : "Salva prima il driver in Dispositivi. Il tool non contiene driver preimpostati."}
                  </p>
                  {!drivers.length && (
                    <button
                      className={`${button} mt-2`}
                      onClick={() => navigate("device-recipe-editor")}
                    >
                      Crea un driver
                      <ArrowRight size={13} />
                    </button>
                  )}
                </section>
                {driver && (
                  <>
                    <section className={panel}>
                      <div className="flex flex-wrap items-center gap-2">
                        {DISPLAY_FUNCTIONS.map((id) => (
                          <button
                            key={id}
                            className={`${button} ${functionId === id ? "border-brand-blue bg-brand-blue/10" : ""}`}
                            onClick={() => setFunctionId(id)}
                          >
                            {DISPLAY_FUNCTION_LABELS[id]}
                            <span className="text-ink-faint">
                              {project.adapter[id]?.length ?? 0}
                            </span>
                          </button>
                        ))}
                      </div>
                      <p className="mt-3 font-body text-xs text-ink-muted">
                        Parametri del tool:{" "}
                        <code className="text-brand-blue">
                          {displayFunctionInputs(functionId).join(", ")}
                        </code>
                      </p>
                      <p className="mt-1 font-body text-[11px] text-ink-muted">
                        Associa le azioni nell’ordine di esecuzione. Le formule e il
                        formato dei byte li definisci tu.
                      </p>
                      <div className="mt-3 space-y-3">
                        {(project.adapter[functionId] ?? []).map((call, index) => (
                          <AdapterCallEditor
                            key={`${call.id}:${driver.id}`}
                            call={call}
                            driver={driver}
                            disabled={running}
                            index={index}
                            onChange={(next) => patchCall(call.id, next)}
                            onRemove={() =>
                              patch({
                                adapter: {
                                  ...project.adapter,
                                  [functionId]: (
                                    project.adapter[functionId] ?? []
                                  ).filter((item) => item.id !== call.id),
                                },
                              })
                            }
                          />
                        ))}
                      </div>
                      <button
                        className={`${button} mt-3`}
                        disabled={running}
                        onClick={() =>
                          patch({
                            adapter: {
                              ...project.adapter,
                              [functionId]: [
                                ...(project.adapter[functionId] ?? []),
                                newCall(),
                              ],
                            },
                          })
                        }
                      >
                        <Plus size={13} />
                        Azione del driver
                      </button>
                    </section>
                    <details className={panel}>
                      <summary className="cursor-pointer font-body text-sm font-semibold text-ink">
                        Formule e conversioni
                      </summary>
                      <div className="mt-3 space-y-2 font-body text-xs text-ink-muted">
                        <p>
                          Numeri: <code>x1</code>, <code>round(x1 / 2)</code>,{" "}
                          <code>x1 &amp; 255</code>,{" "}
                          <code>(x1 &gt;&gt; 8) &amp; 255</code>. Per un numero scegli
                          larghezza e ordine dei byte nell’ingresso.
                        </p>
                        <p>
                          Byte manuali:{" "}
                          <code>bytes(lo(x1), hi(x1), lo(y1), hi(y1))</code>,{" "}
                          <code>le16(x1)</code>, <code>be16(y1)</code>. Liste e{" "}
                          <code>chunk</code> vengono inviate integralmente.
                        </p>
                        <p>
                          Testo: <code>utf8(text)</code>,{" "}
                          <code>ascii("LINE " + x1 + "," + y1)</code>. Puoi usare{" "}
                          <code>concat</code>, <code>slice</code>, <code>len</code>,{" "}
                          <code>min</code>, <code>max</code>, <code>clamp</code>.
                        </p>
                        <p>
                          Framebuffer: mappa “Aggiorna” con ripetizione per blocchi e
                          formula <code>chunk</code>. <code>offset</code> e{" "}
                          <code>index</code> permettono di impostare indirizzi o pagine.
                          Il formato dei pixel si sceglie nella scheda Disegno.
                        </p>
                        <p>
                          Risposte: <code>rx0[0]</code>,{" "}
                          <code>rx0[0] + 256 * rx0[1]</code>. <code>rx0</code>,{" "}
                          <code>rx1</code> sono le letture reali della singola chiamata.
                          Un byte mancante produce un errore.
                        </p>
                      </div>
                    </details>
                  </>
                )}
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                <section className={panel}>
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    {(["pixel", "line", "rect", "text"] as const).map((id) => (
                      <button
                        key={id}
                        className={`${button} ${kind === id ? "border-brand-blue bg-brand-blue/10" : ""}`}
                        disabled={running}
                        onClick={() => setKind(id)}
                      >
                        {DISPLAY_FUNCTION_LABELS[id]}
                      </button>
                    ))}
                    <button
                      className={button}
                      disabled={running}
                      onClick={() => {
                        const id = crypto.randomUUID();
                        patch({
                          elements: [
                            ...project.elements,
                            {
                              id,
                              kind: "clear",
                              x1: 0,
                              y1: 0,
                              x2: 0,
                              y2: 0,
                              color: 0,
                              text: "",
                              filled: false,
                            },
                          ],
                        });
                        setSelectedId(id);
                      }}
                    >
                      Pulisci
                    </button>
                    <label className="ml-auto flex items-center gap-1 font-body text-xs text-ink-muted">
                      Dimensioni
                      <input
                        aria-label="Larghezza display"
                        type="number"
                        min={1}
                        max={512}
                        className={`${field} w-16`}
                        value={project.width}
                        disabled={running}
                        onChange={(event) =>
                          patch({
                            width: Math.max(
                              1,
                              Math.min(512, Number(event.target.value) || 1),
                            ),
                          })
                        }
                      />
                      <span>×</span>
                      <input
                        aria-label="Altezza display"
                        type="number"
                        min={1}
                        max={512}
                        className={`${field} w-16`}
                        value={project.height}
                        disabled={running}
                        onChange={(event) =>
                          patch({
                            height: Math.max(
                              1,
                              Math.min(512, Number(event.target.value) || 1),
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="overflow-auto rounded-lg bg-slate-900 p-5">
                    <svg
                      aria-label="Area grafica display"
                      role="img"
                      viewBox={`0 0 ${project.width} ${project.height}`}
                      className="mx-auto block w-full max-w-3xl touch-none bg-black"
                      style={{
                        aspectRatio: `${project.width}/${project.height}`,
                        imageRendering: "pixelated",
                        cursor: "crosshair",
                      }}
                      onPointerDown={startDrawing}
                      onPointerMove={updateDrawing}
                      onPointerUp={() => {
                        drag.current = null;
                      }}
                      onPointerCancel={() => {
                        drag.current = null;
                      }}
                    >
                      <path
                        d={drawing.path}
                        fill="#c9f5ff"
                        shapeRendering="crispEdges"
                      />
                    </svg>
                  </div>
                  <p className="mt-2 font-body text-xs text-ink-muted">
                    Trascina per disegnare. Per punto e testo basta un clic. Anteprima
                    monocromatica, testo bitmap 5×7.
                  </p>
                  {drawing.error && (
                    <p className="mt-2 font-body text-xs text-error">{drawing.error}</p>
                  )}
                  <label className="mt-4 block max-w-md font-body text-xs text-ink-muted">
                    Formato framebuffer del tool
                    <select
                      className={`${field} mt-1`}
                      value={project.packing}
                      disabled={running}
                      onChange={(event) =>
                        patch({ packing: event.target.value as "pages" | "rows" })
                      }
                    >
                      <option value="pages">
                        1 bit/pixel · pagine verticali da 8 pixel
                      </option>
                      <option value="rows">
                        1 bit/pixel · righe orizzontali, MSB a sinistra
                      </option>
                    </select>
                  </label>
                  <details className="mt-4 border-t border-border pt-3">
                    <summary className="cursor-pointer font-body text-xs font-semibold text-ink">
                      Anteprima invio · {compiled.calls.length} chiamate
                    </summary>
                    {compiled.error ? (
                      <p className="mt-2 font-body text-xs text-ink-muted">
                        {compiled.error}
                      </p>
                    ) : (
                      <ol className="mt-2 max-h-72 space-y-2 overflow-auto">
                        {compiled.calls.slice(0, 128).map((call, index) => (
                          <li key={index} className="rounded-lg bg-surface-sunken p-2">
                            <strong className="font-body text-xs text-ink">
                              {index + 1}. {DISPLAY_FUNCTION_LABELS[call.function]} ·{" "}
                              {call.actionLabel}
                            </strong>
                            <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] text-ink-muted">
                              {call.steps
                                .map((op) =>
                                  op.type === "i2c_write"
                                    ? `WRITE ${op.bytes.join(" ")}`
                                    : op.type === "i2c_write_read"
                                      ? `WRITE ${op.writeBytes.join(" ")} / READ ${op.readLen} byte`
                                      : op.type === "i2c_read"
                                        ? `READ ${op.len} byte`
                                        : op.type,
                                )
                                .join("\n")}
                            </pre>
                          </li>
                        ))}
                      </ol>
                    )}
                  </details>
                </section>
                <aside className="space-y-4">
                  <section className={panel}>
                    <h2 className="font-body text-sm font-semibold text-ink">
                      Elementi
                    </h2>
                    <ol className="mt-3 max-h-64 space-y-1 overflow-auto">
                      {project.elements.map((element, index) => (
                        <li key={element.id} className="flex items-center gap-1">
                          <button
                            className={`min-w-0 flex-1 rounded-lg p-2 text-left font-body text-xs ${selectedId === element.id ? "bg-brand-blue/10 text-brand-blue" : "text-ink"}`}
                            onClick={() => setSelectedId(element.id)}
                          >
                            {index + 1}. {DISPLAY_FUNCTION_LABELS[element.kind]}
                          </button>
                          <button
                            className="p-1.5 text-error"
                            aria-label={`Elimina elemento ${index + 1}`}
                            disabled={running}
                            onClick={() => {
                              patch({
                                elements: project.elements.filter(
                                  (item) => item.id !== element.id,
                                ),
                              });
                              if (selectedId === element.id) setSelectedId(null);
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </li>
                      ))}
                    </ol>
                    {selected && (
                      <fieldset
                        disabled={running}
                        className="mt-3 space-y-2 border-t border-border pt-3"
                      >
                        {(["x1", "y1", "x2", "y2"] as const).map((key) => (
                          <label
                            key={key}
                            className="flex items-center gap-2 font-body text-xs text-ink-muted"
                          >
                            {key}
                            <input
                              aria-label={key}
                              type="number"
                              min={0}
                              max={511}
                              className={field}
                              value={selected[key]}
                              onChange={(event) =>
                                patchElement(selected.id, {
                                  [key]: Math.max(
                                    0,
                                    Math.min(511, Number(event.target.value) || 0),
                                  ),
                                })
                              }
                            />
                          </label>
                        ))}
                        {selected.kind === "text" && (
                          <input
                            aria-label="Testo display"
                            className={field}
                            maxLength={128}
                            value={selected.text}
                            onChange={(event) =>
                              patchElement(selected.id, { text: event.target.value })
                            }
                          />
                        )}
                        {selected.kind === "rect" && (
                          <label className="flex items-center gap-2 font-body text-xs text-ink-muted">
                            <input
                              type="checkbox"
                              checked={selected.filled}
                              onChange={(event) =>
                                patchElement(selected.id, {
                                  filled: event.target.checked,
                                })
                              }
                            />
                            Riempito
                          </label>
                        )}
                        <label className="flex items-center gap-2 font-body text-xs text-ink-muted">
                          <input
                            type="checkbox"
                            checked={selected.color === 1}
                            onChange={(event) =>
                              patchElement(selected.id, {
                                color: event.target.checked ? 1 : 0,
                              })
                            }
                          />
                          Pixel accesi
                        </label>
                      </fieldset>
                    )}
                  </section>
                  <section className={panel}>
                    <h2 className="font-body text-sm font-semibold text-ink">
                      Invio al display
                    </h2>
                    <p className="mt-2 font-body text-xs text-ink-muted">
                      {driver
                        ? `${driver.name} · ${driver.binding.bus.toUpperCase()} ${driver.binding.i2c?.address ?? ""}`
                        : "Nessun driver selezionato"}
                    </p>
                    <button
                      className={`${button} mt-3 w-full`}
                      onClick={() => setTab("adapter")}
                    >
                      Driver e adapter
                    </button>
                    <label className="mt-3 flex gap-2 font-body text-xs text-ink-muted">
                      <input
                        type="checkbox"
                        disabled={running}
                        checked={withInit}
                        onChange={(event) => setWithInit(event.target.checked)}
                      />
                      Esegui l’inizializzazione del driver
                    </label>
                    <button
                      className={`${button} mt-3 w-full`}
                      disabled={running || Boolean(compiled.error)}
                      onClick={() => void run()}
                    >
                      <Play size={13} />
                      Prova sul display
                    </button>
                    {running && (
                      <button
                        className={`${button} mt-2 w-full`}
                        onClick={() => abort.current?.abort()}
                      >
                        <Square size={12} />
                        Interrompi e ripristina
                      </button>
                    )}
                    <button
                      className={`${button} mt-2 w-full`}
                      disabled={running || Boolean(compiled.error)}
                      onClick={generateAction}
                    >
                      Genera azione nel driver
                    </button>
                    <p className="mt-2 font-body text-[10px] text-ink-muted">
                      La prova hardware usa il driver I²C e ripristina la configurazione
                      precedente. L’azione generata si apre in Dispositivi per usarla
                      nel canvas, entro i limiti del runtime.
                    </p>
                  </section>
                </aside>
                {!!results.length && (
                  <section className={`${panel} xl:col-span-2`}>
                    <h2 className="font-body text-sm font-semibold text-ink">
                      Risposte reali e conversioni dell’adapter
                    </h2>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink">
                      {results
                        .map(
                          (result) =>
                            `Chiamata ${result.index + 1}\n${result.reads.map((bytes, index) => `RX${index}: ${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ")}`).join("\n")}\n${JSON.stringify(result.values)}`,
                        )
                        .join("\n\n")}
                    </pre>
                  </section>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AdapterCallEditor({
  call,
  driver,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  call: DisplayAdapterCall;
  driver: DeviceRecipeDraft;
  index: number;
  disabled: boolean;
  onChange: (next: Partial<DisplayAdapterCall>) => void;
  onRemove: () => void;
}) {
  const variables = recipeVariables(driver);
  const updateInput = (inputIndex: number, patch: Partial<AdapterInput>) =>
    onChange({
      inputs: call.inputs.map((input, i) =>
        i === inputIndex ? { ...input, ...patch } : input,
      ),
    });
  function chooseAction(actionId: string) {
    const action = driver.commands.find((action) => action.id === actionId);
    const names = new Set<string>();
    if (action)
      effectiveActionSteps(driver, action).forEach((op) => {
        const tokens =
          op.type === "i2c_write"
            ? op.bytes
            : op.type === "i2c_write_read"
              ? op.writeBytes
              : op.type === "spi_transfer"
                ? op.txBytes
                : [];
        tokens.forEach((token) => {
          if (token.startsWith("$")) names.add(token.slice(1));
        });
      });
    onChange({
      actionId,
      inputs: variables
        .filter((variable) => names.has(variable.name))
        .map((variable) => ({
          variableId: variable.id,
          expression: "",
          width: 1,
          byteOrder: "be",
        })),
    });
  }
  return (
    <fieldset
      disabled={disabled}
      className="space-y-3 rounded-lg border border-border bg-surface-sunken/40 p-3"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-ink-muted">{index + 1}</span>
        <select
          aria-label={`Azione driver ${index + 1}`}
          value={call.actionId}
          className={field}
          onChange={(event) => chooseAction(event.target.value)}
        >
          <option value="">Seleziona un’azione</option>
          {driver.commands.map((action) => (
            <option key={action.id} value={action.id}>
              {action.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="p-1.5 text-error"
          aria-label="Rimuovi azione dall’adapter"
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="font-body text-xs text-ink-muted">
          Ripetizione
          <select
            className={`${field} mt-1`}
            value={call.repeat}
            onChange={(event) =>
              onChange({ repeat: event.target.value as "once" | "frame-chunks" })
            }
          >
            <option value="once">Una volta</option>
            <option value="frame-chunks">Per ogni blocco framebuffer</option>
          </select>
        </label>
        {call.repeat === "frame-chunks" && (
          <label className="font-body text-xs text-ink-muted">
            Byte per blocco
            <input
              type="number"
              min={1}
              max={32}
              value={call.chunkSize}
              className={`${field} mt-1`}
              onChange={(event) =>
                onChange({
                  chunkSize: Math.max(1, Math.min(32, Number(event.target.value) || 1)),
                })
              }
            />
          </label>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="font-body text-xs font-semibold text-ink">
          Conversione ingressi del driver
        </h3>
        {call.inputs.map((input, inputIndex) => (
          <div
            key={inputIndex}
            className="space-y-2 rounded-lg border border-border bg-surface p-2"
          >
            <div className="flex gap-2">
              <select
                aria-label="Variabile del driver"
                value={input.variableId}
                className={field}
                onChange={(event) =>
                  updateInput(inputIndex, { variableId: event.target.value })
                }
              >
                <option value="">Variabile</option>
                {variables.map((variable) => (
                  <option key={variable.id} value={variable.id}>
                    ${variable.name}
                  </option>
                ))}
              </select>
              <button
                className="text-error"
                aria-label="Rimuovi conversione ingresso"
                onClick={() =>
                  onChange({ inputs: call.inputs.filter((_, i) => i !== inputIndex) })
                }
              >
                <Trash2 size={12} />
              </button>
            </div>
            <input
              aria-label="Formula ingresso adapter"
              value={input.expression}
              className={field}
              placeholder="Formula, es. x1, le16(x1), bytes(...), chunk"
              onChange={(event) =>
                updateInput(inputIndex, { expression: event.target.value })
              }
            />
            <div className="flex gap-2">
              <label className="flex-1 font-body text-[10px] text-ink-muted">
                Byte per valore numerico
                <input
                  className={field}
                  type="number"
                  min={1}
                  max={8}
                  value={input.width}
                  onChange={(event) =>
                    updateInput(inputIndex, {
                      width: Math.max(1, Math.min(8, Number(event.target.value) || 1)),
                    })
                  }
                />
              </label>
              <label className="flex-1 font-body text-[10px] text-ink-muted">
                Ordine
                <select
                  className={field}
                  value={input.byteOrder}
                  onChange={(event) =>
                    updateInput(inputIndex, {
                      byteOrder: event.target.value as "le" | "be",
                    })
                  }
                >
                  <option value="be">Big endian</option>
                  <option value="le">Little endian</option>
                </select>
              </label>
            </div>
          </div>
        ))}
        <button
          className={button}
          onClick={() =>
            onChange({
              inputs: [
                ...call.inputs,
                { variableId: "", expression: "", width: 1, byteOrder: "be" },
              ],
            })
          }
        >
          <Plus size={12} />
          Conversione ingresso
        </button>
      </div>
      <div className="space-y-2">
        <h3 className="font-body text-xs font-semibold text-ink">
          Conversione risposte per il tool
        </h3>
        {call.outputs.map((output, outputIndex) => (
          <div key={outputIndex} className="flex flex-wrap gap-2">
            <input
              aria-label="Nome risultato adapter"
              className={`${field} sm:w-36`}
              value={output.name}
              onChange={(event) =>
                onChange({
                  outputs: call.outputs.map((item, i) =>
                    i === outputIndex ? { ...item, name: event.target.value } : item,
                  ),
                })
              }
            />
            <input
              aria-label="Formula risposta adapter"
              className={`${field} flex-1`}
              value={output.expression}
              placeholder="Es. rx0[0] + 256 * rx0[1]"
              onChange={(event) =>
                onChange({
                  outputs: call.outputs.map((item, i) =>
                    i === outputIndex
                      ? { ...item, expression: event.target.value }
                      : item,
                  ),
                })
              }
            />
            <button
              className="text-error"
              aria-label="Rimuovi conversione risposta"
              onClick={() =>
                onChange({ outputs: call.outputs.filter((_, i) => i !== outputIndex) })
              }
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          className={button}
          onClick={() =>
            onChange({
              outputs: [
                ...call.outputs,
                { name: `valore${call.outputs.length + 1}`, expression: "" },
              ],
            })
          }
        >
          <Plus size={12} />
          Conversione risposta
        </button>
      </div>
    </fieldset>
  );
}
