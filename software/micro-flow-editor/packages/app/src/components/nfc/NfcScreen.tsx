import { tagIsPresent } from "../../lib/nfc-workspace.js";
import {
  BookOpen,
  Image as ImageIcon,
  Nfc,
  Radio,
  RefreshCw,
  Pencil,
  Plus,
  CircuitBoard,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useNfcWorkspace } from "../../state/nfc-workspace-context.js";
import {
  remoteDriverCatalog,
  associateTagInLibrary,
  encodeModuleTag,
  decodeModuleTag,
  type ModuleTag,
  type TagScan,
} from "../../lib/nfc-workspace.js";
import "./nfc.css";
export function DriverOptions() {
  const { library } = useNfcWorkspace();
  return (
    <>
      <option value="">Seleziona un driver</option>
      {library.drivers.map((d) => (
        <option
          key={`${d.id}@${d.version}`}
          value={`${d.id}@${d.version}`}
          disabled={!d.ready}
        >
          {d.draft.name} · {new Date(Number(d.version)).toLocaleDateString("it-IT")}{" "}
          {d.ready ? "" : "(bozza)"}
        </option>
      ))}
      <option value="__create">＋ Crea driver</option>
    </>
  );
}
export function NfcScreen() {
  const nfc = useNfcWorkspace();
  const [tab, setTab] = useState("tags");
  const recent = nfc.history
    .filter((scan) => !scan.simulated)
    .filter(
      (scan, index, all) => all.findIndex((item) => item.uid === scan.uid) === index,
    )
    .slice(0, 30);
  return (
    <div className="nfc-page">
      <header className="nfc-page-head">
        <div>
          <h1>{tab === "tags" ? "Tag NFC" : "Libreria moduli"}</h1>
          <p>
            {tab === "tags"
              ? "Leggi, scrivi e associa i tag ai tuoi moduli"
              : "I tuoi moduli e driver, disponibili in tutti i progetti"}
          </p>
        </div>
        <button
          type="button"
          className="nfc-btn"
          onClick={() => setTab(tab === "tags" ? "library" : "tags")}
        >
          {tab === "tags" ? <BookOpen size={16} /> : <Nfc size={16} />}
          {tab === "tags" ? "Libreria" : "Tag NFC"}
        </button>
      </header>
      {tab === "library" ? (
        <NfcLibrary />
      ) : (
        <div className="nfc-layout">
          <aside className="nfc-sidebar">
            <h3>Tag recenti</h3>
            {recent.map((scan) => (
              <div
                className="nfc-recent-row"
                data-current={nfc.selected?.uid === scan.uid || undefined}
                data-present={tagIsPresent(scan, nfc.presentKeys) || undefined}
                key={scan.uid}
              >
                <button
                  type="button"
                  className="nfc-recent"
                  aria-current={nfc.selected?.uid === scan.uid}
                  onClick={() => nfc.openTag(scan.id)}
                >
                  <Nfc size={24} className="shrink-0 text-brand-blue" />
                  <div className="min-w-0">
                    <strong className="truncate">{scan.name}</strong>
                    <small>
                      {tagIsPresent(scan, nfc.presentKeys)
                        ? "Sul lettore"
                        : new Date(scan.at).toLocaleTimeString("it-IT", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                    </small>
                  </div>
                </button>
                <button
                  type="button"
                  className="nfc-recent-delete"
                  aria-label={`Elimina ${scan.name}`}
                  title="Elimina tag dalla cronologia"
                  onClick={() => nfc.deleteTag(scan.uid)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {!recent.length && (
              <p className="nfc-muted px-3">I tag scansionati compariranno qui.</p>
            )}
            <div className="nfc-reader">
              <h3>Lettore</h3>
              <div className="flex items-center gap-2">
                <Radio size={18} />
                <strong className="text-sm">NFC tramite master</strong>
              </div>
              <p className="nfc-muted">
                Avvicina un tag al lettore collegato al master per leggerlo o
                modificarlo.
              </p>
              <details>
                <summary className="nfc-text-button cursor-pointer py-2">
                  Prova con lettore simulato
                </summary>
                <p className="nfc-muted mb-3">
                  Ambiente di prova: non scrive tag fisici.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    className="nfc-btn"
                    type="button"
                    disabled={nfc.busy}
                    onClick={() => nfc.simulate("blank")}
                  >
                    <Plus size={14} />
                    Nuovo tag vuoto
                  </button>
                  <button
                    className="nfc-btn"
                    type="button"
                    disabled={nfc.busy || nfc.simulator.present}
                    onClick={() => nfc.simulate("present")}
                  >
                    Avvicina di nuovo
                  </button>
                  <button
                    className="nfc-btn"
                    type="button"
                    disabled={nfc.busy || !nfc.simulator.present}
                    onClick={() => nfc.simulate("remove")}
                  >
                    Rimuovi tag
                  </button>
                  <label className="nfc-field">
                    Prova errori
                    <select
                      className="nfc-select"
                      defaultValue="none"
                      onChange={(e) => {
                        nfc.setSimulationFailure(
                          e.target.value as typeof nfc.simulator.failure,
                        );
                      }}
                    >
                      <option value="none">Nessun errore</option>
                      <option value="removed">Tag rimosso</option>
                      <option value="changed">Tag sostituito</option>
                      <option value="timeout">Timeout</option>
                    </select>
                  </label>
                </div>
              </details>
            </div>
          </aside>
          {nfc.selected ? (
            <TagDetail key={nfc.selected.id} scan={nfc.selected} />
          ) : (
            <div className="nfc-empty">
              <Nfc size={46} />
              <h2>Avvicina un tag al lettore</h2>
              <p>Le scansioni e il contenuto del tag compariranno qui.</p>
              <p className="nfc-muted">
                Puoi provare il percorso con il lettore simulato a sinistra.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function TagDetail({ scan }: { scan: TagScan }) {
  const nfc = useNfcWorkspace();
  const [tab, setTab] = useState("data");
  const [feedback, setFeedback] = useState("");
  const [failure, setFailure] = useState("");
  const value = scan.decoded.kind === "module" ? scan.decoded.value : undefined;
  const associated = nfc.library.units.find((u) => u.uid === scan.uid);
  const model = nfc.library.models.find(
    (m) => m.id === (associated?.modelId ?? value?.modelId),
  );
  const [name, setName] = useState(value?.name ?? model?.name ?? "");
  const [driver, setDriver] = useState(
    model?.driverId
      ? `${model.driverId}@${model.driverVersion}`
      : value?.driverId
        ? `${value.driverId}@${value.driverVersion}`
        : "",
  );
  const [modelId] = useState(
    value?.modelId ?? associated?.modelId ?? `m-${crypto.randomUUID().slice(0, 8)}`,
  );
  const present = tagIsPresent(scan, nfc.presentKeys);
  const [driverId, driverVersion] = driver.split("@");
  const payload: ModuleTag = {
    type: "module",
    name,
    modelId,
    unitId: value?.unitId ?? scan.uid,
    driverId: driverId ?? "",
    driverVersion: driverVersion ?? "",
  };
  let size = "";
  let payloadError = "";
  try {
    const bytes = encodeModuleTag(payload);
    size = `${8 + new DataView(bytes.buffer).getUint16(6, true) + 4} / 160 byte`;
  } catch (e) {
    payloadError = e instanceof Error ? e.message : "Contenuto non valido";
  }
  const canAssociate = !!name.trim() && !!driver && !payloadError;
  const memoryKind = scan.memory
    ? decodeModuleTag(Uint8Array.from(scan.memory)).kind
    : "unknown";
  const canPrepareWrite =
    present &&
    canAssociate &&
    (!scan.memory || (scan.writable && ["empty", "module"].includes(memoryKind)));
  const writing = nfc.writeSession?.uid === scan.uid;
  const dirty =
    name !== (value?.name ?? "") ||
    driver !== (value?.driverId ? `${value.driverId}@${value.driverVersion}` : "");
  function associateInLibrary() {
    nfc.updateLibrary((previous) =>
      associateTagInLibrary(previous, scan.uid, {
        id: modelId,
        name: name.trim(),
        driverId: driverId ?? "",
        driverVersion: driverVersion ?? "",
        imageRef: model?.imageRef,
        voltage: model?.voltage,
        origin: "local",
      }),
    );
  }
  async function saveLibraryModel() {
    associateInLibrary();
  }
  async function startWrite() {
    setFailure("");
    setFeedback("");
    try {
      await nfc.beginWriteSession(scan);
      await confirmWrite();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Impossibile aprire la scrittura.");
    }
  }
  async function confirmWrite() {
    setFailure("");
    setFeedback("");
    try {
      await nfc.writeTag(scan, payload);
      await saveLibraryModel();
      setFeedback("Scrittura completata.");
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Scrittura fallita.");
    }
  }
  return (
    <section className="nfc-detail">
      <div className="nfc-detail-title">
        <h2>{value?.name ?? model?.name ?? scan.name}</h2>
        <span className="nfc-badge">
          {scan.decoded.kind === "module"
            ? "Tag modulo"
            : scan.decoded.kind === "empty"
              ? "Tag vuoto"
              : "Tag NFC"}
        </span>
        {scan.recognition === "library" && (
          <span className="nfc-badge">Associazione locale</span>
        )}
        {scan.simulated && <span className="nfc-badge sim">Simulazione</span>}
      </div>
      {scan.recognition === "library" && (
        <p className="nfc-info mt-3">
          Nome e driver provengono dalla tua libreria. Questa associazione non conferma
          una scrittura nel tag.
        </p>
      )}
      <p className="nfc-muted mt-3">
        <span className={`nfc-dot ${present ? "" : "off"}`} />
        {present
          ? "Tag presente sul lettore"
          : "Tag non presente · dettaglio della scansione"}
      </p>
      <div className="nfc-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "data"}
          onClick={() => setTab("data")}
        >
          Dati del tag
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "memory"}
          onClick={() => setTab("memory")}
        >
          Memoria
        </button>
      </div>
      {tab === "memory" ? (
        <>
          <p className="nfc-muted mb-4">
            Memoria effettivamente letta · area utente · {scan.memory?.length ?? 0} byte
          </p>
          <pre className="nfc-memory">
            {scan.memory
              ? Array.from(
                  { length: Math.ceil(scan.memory.length / 16) },
                  (_, i) =>
                    `${(i * 16).toString(16).toUpperCase().padStart(4, "0")}  ${scan
                      .memory!.slice(i * 16, i * 16 + 16)
                      .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
                      .join(" ")}`,
                ).join("\n")
              : "La memoria non è disponibile nel firmware attuale."}
          </pre>
        </>
      ) : (
        <>
          <div className="nfc-fields">
            <label className="nfc-field">
              Tipo di tag
              <select value="module" onChange={() => {}}>
                <option value="module">Modulo</option>
              </select>
            </label>
            <label className="nfc-field">
              Nome del modulo
              <input
                aria-label="Nome del modulo"
                value={name}
                placeholder="Es. Display OLED"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="nfc-field">
              Driver associato
              <select
                aria-label="Driver associato"
                value={driver}
                onChange={(e) => {
                  if (e.target.value === "__create") nfc.createDriver(scan, name);
                  else setDriver(e.target.value);
                }}
              >
                <DriverOptions />
              </select>
              <span className="nfc-muted">
                {driver
                  ? "Driver locale · non verificato dal catalogo"
                  : "Scegli un driver esistente o crea il tuo"}
              </span>
            </label>
            <div className="nfc-field">
              Immagine
              <div className="nfc-image">
                {model?.imageRef ? (
                  <img src={model.imageRef} alt={name} />
                ) : (
                  <>
                    <ImageIcon size={30} />
                    <span>Immagine da aggiungere</span>
                    <small>Associata al modulo nella libreria</small>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="nfc-info">
            L’associazione al modulo sta in libreria: non serve scrivere il tag.
            Immagine e driver restano qui; sul chip andrebbero solo i riferimenti.
          </div>
          {associated && (
            <p className="nfc-info nfc-success mt-4">
              Questo tag è associato a {model?.name ?? "un modulo"} in libreria.
            </p>
          )}
          {dirty && (
            <p className="nfc-muted mt-3">
              Modifiche da scrivere sul tag{size ? ` · ${size}` : ""}
            </p>
          )}
          {writing && (
            <div className="nfc-info nfc-write-mode mt-4" role="status">
              <strong>Scrittura e verifica in corso</strong>
              <p>
                Tieni il tag fermo sul lettore fino alla conferma. Puoi annullare
                l’operazione.
              </p>
            </div>
          )}
          {scan.decoded.kind !== "module" &&
            scan.decoded.kind !== "empty" &&
            !writing && (
              <p className="nfc-info nfc-error mt-4">
                {scan.decoded.reason?.includes("SpaghettiClient") ||
                scan.decoded.reason?.includes("INTERNAL_ERROR") ||
                scan.decoded.reason?.includes("INVALID_ARGUMENT")
                  ? "Lettura memoria non riuscita. Tieni il tag fermo sul lettore e premi Rileggi."
                  : (scan.decoded.reason ?? "Formato non supportato per la scrittura.")}
              </p>
            )}
          {!present && (
            <p className="nfc-info mt-4">
              Riavvicina lo stesso tag per leggerlo o scriverlo.
            </p>
          )}
          {(failure || feedback) && (
            <p
              role="status"
              className={`nfc-info mt-4 ${failure ? "nfc-error" : "nfc-success"}`}
            >
              {failure || feedback}
            </p>
          )}
          {nfc.operationNote && !nfc.error && (
            <p role="status" className="nfc-info nfc-success mt-4">
              {nfc.operationNote}
            </p>
          )}
          {nfc.error && (
            <p role="alert" className="nfc-info nfc-error mt-4">
              {nfc.error}
            </p>
          )}
          <div className="nfc-actions">
            {(value || model) && (
              <button
                type="button"
                className="nfc-btn"
                disabled={writing || nfc.busy}
                onClick={() => nfc.showModule(scan)}
              >
                <CircuitBoard size={16} />
                Collega al canvas
              </button>
            )}
            <button
              type="button"
              className="nfc-btn"
              disabled={nfc.busy || !present || writing}
              onClick={() => {
                setFailure("");
                void nfc
                  .readTag(scan)
                  .catch((e) =>
                    setFailure(e instanceof Error ? e.message : "Lettura fallita."),
                  );
              }}
            >
              <RefreshCw size={16} />
              {nfc.busy && !writing ? "Operazione in corso…" : "Rileggi tag"}
            </button>
            <button
              type="button"
              className="nfc-btn primary"
              title={payloadError || undefined}
              disabled={!canAssociate}
              onClick={() => {
                setFailure("");
                associateInLibrary();
                setFeedback("Tag associato in libreria. Non è necessario scriverlo.");
              }}
            >
              <Pencil size={16} />
              Associa
            </button>
            {writing ? (
              <>
                <button
                  type="button"
                  className="nfc-btn"
                  onClick={() => nfc.cancelWriteSession()}
                >
                  Annulla
                </button>
              </>
            ) : (
              <button
                type="button"
                className="nfc-btn"
                title={payloadError || undefined}
                disabled={nfc.busy || !canPrepareWrite}
                onClick={() => void startWrite()}
              >
                Scrivi e verifica
              </button>
            )}
          </div>
        </>
      )}
      <footer className="nfc-footer">
        <span>
          UID <code>{scan.uid.match(/.{1,2}/g)?.join(":")}</code>
        </span>
        <span>Ultima lettura: {new Date(scan.at).toLocaleString("it-IT")}</span>
      </footer>
    </section>
  );
}
function NfcLibrary() {
  const nfc = useNfcWorkspace();
  return (
    <section className="nfc-library">
      <div className="nfc-tabs">
        <span className="py-3 font-semibold text-brand-blue">Driver locali</span>
      </div>
      <p className="nfc-info">{remoteDriverCatalog.status}</p>
      <div className="nfc-card-grid">
        {nfc.library.drivers.map((driver) => (
          <article key={`${driver.id}@${driver.version}`} className="nfc-card">
            <CircuitBoard size={24} className="mb-4 text-brand-blue" />
            <h3>{driver.draft.name}</h3>
            <p className="nfc-muted">
              {driver.draft.binding.bus.toUpperCase()} · {driver.draft.commands.length}{" "}
              azioni
            </p>
            <p className="nfc-muted mt-2">
              Revisione {new Date(Number(driver.version)).toLocaleString("it-IT")}
            </p>
            <span className="nfc-badge mt-4">
              {driver.ready ? "Disponibile in locale" : "Bozza"}
            </span>
          </article>
        ))}
      </div>
      {!nfc.library.drivers.length && (
        <div className="nfc-empty">
          <BookOpen size={36} />
          <p>I driver salvati in Dispositivi appariranno qui.</p>
        </div>
      )}
      <h2 className="mt-8">Moduli associati</h2>
      <div className="nfc-card-grid">
        {nfc.library.models.map((model) => (
          <article className="nfc-card" key={model.id}>
            <h3>{model.name}</h3>
            <span className="nfc-badge">Locale · non verificato</span>
            <p className="nfc-muted mt-3">
              {nfc.library.units.filter((u) => u.modelId === model.id).length} tag
              associati
            </p>
            <label className="nfc-field mt-4">
              Alimentazione del modulo
              <select
                value={model.voltage ?? ""}
                onChange={(e) =>
                  nfc.updateLibrary((previous) => ({
                    ...previous,
                    models: previous.models.map((m) =>
                      m.id === model.id
                        ? { ...m, voltage: e.target.value as "3.3V" | "5V" }
                        : m,
                    ),
                  }))
                }
              >
                <option value="">Da specificare</option>
                <option value="3.3V">3.3 V</option>
                <option value="5V">5 V</option>
              </select>
            </label>
          </article>
        ))}
      </div>
    </section>
  );
}
