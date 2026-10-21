import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Palette, Play, Cable, Plus, Trash2 } from "lucide-react";
import {
  readLedDriver,
  validateLedDriver,
  type LedDriverConfig,
} from "../../lib/led-driver.js";
export function LedDriverEditor({
  properties,
  onSave,
  onCancel,
}: {
  properties: Readonly<Record<string, unknown>>;
  onSave: (config: LedDriverConfig) => void;
  onCancel: () => void;
}) {
  const [config, setConfig] = useState(() => readLedDriver(properties));
  const [page, setPage] = useState("actions");
  const [error, setError] = useState("");
  const field = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink";
  function save() {
    try {
      validateLedDriver(config);
      onSave(config);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-ink">
      <header className="flex items-center justify-between gap-3 border-b border-border p-5">
        <div className="flex items-center gap-3">
          <Palette className="text-brand-blue" />
          <div>
            <h1 className="text-xl font-semibold">Generatore colori</h1>
            <p className="text-xs text-ink-muted">
              Un preset, un colore, un comando al LED
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className={field} onClick={onCancel}>
            Annulla
          </button>
          <button
            className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white"
            onClick={save}
          >
            Salva
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="p-4 text-error">
          {error}
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)] max-md:grid-cols-1">
        <nav className="space-y-2 border-r border-border bg-surface-sunken/50 p-3">
          {[
            { id: "init", name: "Inizializzazione", icon: Play },
            { id: "actions", name: "Azioni · preset", icon: Palette },
            { id: "io", name: "Input / Output", icon: Cable },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm ${page === item.id ? "bg-brand-blue/10 font-semibold text-brand-blue" : "text-ink"}`}
            >
              <item.icon size={18} />
              {item.name}
            </button>
          ))}
        </nav>
        <main className="overflow-auto p-6">
          <div className="mx-auto max-w-3xl space-y-4">
            {page === "init" && (
              <>
                <h2 className="text-xl font-semibold">Inizializzazione</h2>
                <p className="rounded-xl border border-border p-5 text-sm leading-relaxed">
                  All’avvio il driver attende un trigger e non modifica il LED. Il LED
                  mantiene la propria inizializzazione. Ogni preset invia il colore una
                  sola volta al cambio di stato: Alto applica il colore, Basso invia nero.
                </p>
              </>
            )}
            {page === "actions" && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Preset colore</h2>
                  <button
                    className={field}
                    disabled={config.presets.length >= 4}
                    onClick={() => {
                      const id = ["0", "1", "2", "3"].find(
                        (id) => !config.presets.some((p) => p.id === id),
                      )!;
                      setConfig({
                        ...config,
                        presets: [
                          ...config.presets,
                          {
                            id,
                            name: `Preset ${Number(id) + 1}`,
                            color: "#FFFFFF",
                            level: "high",
                          },
                        ],
                      });
                    }}
                  >
                    <Plus size={16} className="mr-1 inline" />
                    Preset
                  </button>
                </div>
                <p className="text-sm text-ink-muted">
                  Ogni preset crea un ingresso sul blocco. Scegli in Input / Output se
                  inviare un colore oppure i tre livelli RGB.
                </p>
                {config.presets.map((p) => (
                  <section
                    key={p.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4"
                  >
                    <input
                      aria-label={`Colore ${p.name}`}
                      type="color"
                      className="h-12 w-14 cursor-pointer rounded-lg border border-border bg-surface p-1"
                      value={p.color}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          presets: config.presets.map((item) =>
                            item.id === p.id
                              ? { ...item, color: e.target.value.toUpperCase() }
                              : item,
                          ),
                        })
                      }
                    />
                    <input
                      className={`${field} min-w-0 flex-1`}
                      aria-label={`Nome ${p.name}`}
                      maxLength={48}
                      value={p.name}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          presets: config.presets.map((item) =>
                            item.id === p.id ? { ...item, name: e.target.value } : item,
                          ),
                        })
                      }
                    />
                    <span className="font-mono text-xs text-ink-muted">{p.color}</span>
                    <button
                      aria-label={`Elimina ${p.name}`}
                      disabled={config.presets.length === 1}
                      className="p-2 text-ink-muted disabled:opacity-30"
                      onClick={() =>
                        setConfig({
                          ...config,
                          presets: config.presets.filter((item) => item.id !== p.id),
                        })
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </section>
                ))}
              </>
            )}
            {page === "io" && (
              <>
                <h2 className="text-xl font-semibold">Input / Output</h2>
                <label className="block rounded-xl border border-border p-4 text-sm">
                  Tipo di uscita
                  <select
                    aria-label="Tipo di uscita"
                    className={`${field} ml-3`}
                    value={config.outputMode ?? "hex"}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        outputMode: e.target.value as "hex" | "rgb",
                      })
                    }
                  >
                    <option value="hex">Colore</option>
                    <option value="rgb">RGB · tre canali</option>
                  </select>
                </label>
                <p className="text-sm text-ink-muted">
                  Alto invia il colore del preset; Basso invia nero. Il colore si aggiorna al cambio di stato.
                </p>
                {config.presets.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-border p-4"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ background: p.color }}
                      />
                      {p.name}
                    </span>
                    <span className="text-sm text-ink-muted">Alto: colore · Basso: nero</span>
                  </label>
                ))}
                <section className="rounded-xl border border-border p-4">
                  <h3 className="font-semibold">
                    Uscita ·{" "}
                    {config.outputMode === "rgb" ? "Rosso, Verde, Blu" : "Colore"}
                  </h3>
                  <p className="mt-1 text-sm text-ink-muted">
                    {config.outputMode === "rgb"
                      ? "Tre livelli da 0 a 100%, per gli ingressi Rosso, Verde e Blu."
                      : "Un colore nel formato #RRGGBB, per l’ingresso Ricevi colore."}{" "}
                    Alto applica il colore; Basso imposta tutti i canali a zero.
                  </p>
                </section>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Native dialog keeps the canvas mounted and provides focus trapping and Escape. */
export function LedDriverDialog(props: ComponentProps<typeof LedDriverEditor>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label="Configura Generatore colori"
      onCancel={(event) => {
        event.preventDefault();
        props.onCancel();
      }}
      className="fixed inset-0 m-auto h-[min(520px,85dvh)] max-h-[85dvh] w-[min(900px,94vw)] max-w-[94vw] overflow-hidden rounded-2xl border border-border bg-surface p-0 text-ink shadow-e2 backdrop:bg-black/30 backdrop:backdrop-blur-[2px]"
    >
      <LedDriverEditor {...props} />
    </dialog>
  );
}
