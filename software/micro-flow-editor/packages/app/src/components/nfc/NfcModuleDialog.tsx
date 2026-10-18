import {
  runtimeDigitalOutputPins,
  functionPinGrid,
  formatPinLabel,
  modeIndexToPinId,
  parsePhysicalProject,
  PHYSICAL_META_KEY,
} from "../../lib/backbone-physical.js";
import { parseGpioAssignment } from "../../lib/backbone-sensor-modules.js";
import {
  ArrowLeft,
  CircuitBoard,
  Image as ImageIcon,
  Nfc,
  X,
  ExternalLink,
  Check,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNfcWorkspace } from "../../state/nfc-workspace-context.js";
import { useSession } from "../../state/session-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { usePortProtocol } from "../../state/port-protocol-context.js";
import { installNfcDriver, nfcWiring } from "../../lib/nfc-installation.js";
import {
  recognizedLibraryModule,
  resolveLibraryDriver,
  remoteDriverCatalog,
  type TagScan,
} from "../../lib/nfc-workspace.js";
import { DriverOptions } from "./NfcScreen.js";
import "./nfc.css";
export function NfcModuleDialog() {
  const nfc = useNfcWorkspace();
  return nfc.popup ? <ModuleDialog key={nfc.popup.id} scan={nfc.popup} /> : null;
}
function ModuleDialog({ scan }: { scan: TagScan }) {
  const nfc = useNfcWorkspace();
  const { session, execute, navigate, openBackbonePhysical } = useSession();
  const { rows } = useCoreSessions();
  const { setSelectedBindingId } = usePortProtocol();
  const recognized = recognizedLibraryModule(scan, nfc.library);
  const unit = nfc.library.units.find((u) => u.uid === scan.uid);
  const value = scan.decoded.kind === "module" ? scan.decoded.value : undefined;
  const modelId = unit?.modelId ?? value?.modelId ?? `m-${scan.uid}`;
  const model = recognized?.model ?? nfc.library.models.find((m) => m.id === modelId);
  const name = value?.name ?? model?.name ?? scan.name;
  const targets = (session?.stack.current.coreBindings ?? []).filter((b) => {
    // The NFC-only firmware will expose its role in discovery. Never infer role from label.
    if (
      rows.some((row) =>
        row.attachedBackbones.some(
          (peer) =>
            peer.deviceIdHex === b.expectedDeviceId &&
            peer.productKind === "nfc-reader",
        ),
      )
    )
      return false;
    const role =
      session?.stack.current.authoringMetadata[`device-role:${b.bindingId}`]?.comment;
    return role !== "nfc-reader";
  });
  const [bindingId, setBindingId] = useState(
    targets.length === 1 ? targets[0]!.bindingId : "",
  );
  const [driverValue, setDriverValue] = useState(
    recognized?.driver
      ? `${recognized.driver.id}@${recognized.driver.version}`
      : model?.driverId
        ? `${model.driverId}@${model.driverVersion}`
        : value?.driverId
          ? `${value.driverId}@${value.driverVersion}`
          : "",
  );
  const [voltage, setVoltage] = useState(
    model?.voltage ??
      (recognized?.driver.draft.binding.bus === "gpio" ? "5V" : ""),
  );
  const [gpioValue, setGpioValue] = useState("");
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const [driverId, version] = driverValue.split("@");
  const driver = resolveLibraryDriver(nfc.library, driverId ?? "", version);
  const target = targets.find((b) => b.bindingId === bindingId);
  const gpioPins =
    driver?.draft.binding.bus === "gpio" && session && bindingId
      ? runtimeDigitalOutputPins(
          parsePhysicalProject(
            session.stack.current.authoringMetadata[PHYSICAL_META_KEY]?.comment,
          ).drafts,
          bindingId,
        )
      : [];
  const preferredGpio = parseGpioAssignment(gpioValue) ??
    (gpioPins[0]
      ? { boardKey: gpioPins[0].boardKey, channel: gpioPins[0].channel }
      : undefined);
  let wiring: ReturnType<typeof nfcWiring> | undefined;
  let wiringError = "";
  if (target && driver && session)
    try {
      wiring = nfcWiring(
        session.stack.current,
        bindingId,
        driver.draft,
        voltage,
        preferredGpio,
      );
    } catch (e) {
      wiringError = e instanceof Error ? e.message : "Configurazione non disponibile.";
    }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function keyboard(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        nfc.dismissModule();
      }
      if (e.key === "Tab") {
        const all = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),select,input,[tabindex="0"]',
          ) ?? [],
        );
        if (!all.length) return;
        const first = all[0]!;
        const last = all.at(-1)!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
    // Closing is independent of the changing provider state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function associate() {
    if (!driver) return;
    nfc.updateLibrary((previous) => ({
      ...previous,
      models: [
        ...previous.models.filter((m) => m.id !== modelId),
        {
          id: modelId,
          name,
          driverId: driver.id,
          driverVersion: driver.version,
          imageRef: model?.imageRef,
          voltage: voltage as "3.3V" | "5V",
          origin: "local",
        },
      ],
      units: [
        ...previous.units.filter((u) => u.uid !== scan.uid),
        { uid: scan.uid, modelId, unitId: value?.unitId ?? scan.uid },
      ],
    }));
  }
  function confirm() {
    if (!execute || !driver || !target) return;
    setError("");
    const volts = voltage || "5V";
    try {
      const result = execute({
        kind: "InstallNfcModule",
        apply: (project) => ({
          ok: true,
          value: installNfcDriver(
            project,
            bindingId,
            scan.uid,
            driver.draft,
            driver.version,
            volts,
            preferredGpio,
          ),
        }),
      });
      if (!result.ok) throw new Error("Inserimento nel canvas non riuscito.");
      associate();
      setSelectedBindingId(target.bindingId);
      nfc.dismissModule();
      navigate("processing-graph");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Installazione fallita.");
      setStep(1);
    }
  }
  return (
    <div className="nfc-overlay">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nfc-module-title"
        className="nfc-modal"
      >
        <div className="nfc-modal-head">
          <div className="flex items-center gap-3">
            <Nfc size={23} className="text-brand-blue" />
            <h2 id="nfc-module-title">
              {step === 0 ? "Modulo rilevato" : "Collega il modulo"}
            </h2>
          </div>
          <button
            className="nfc-icon-button"
            type="button"
            aria-label="Chiudi modulo rilevato"
            onClick={nfc.dismissModule}
          >
            <X size={20} />
          </button>
        </div>
        <div className="nfc-module-hero">
          <div className="nfc-image">
            {model?.imageRef ? (
              <img alt={name} src={model.imageRef} />
            ) : (
              <ImageIcon size={32} />
            )}
          </div>
          <div>
            <h3 className="text-xl font-semibold">{name}</h3>
            <span className="nfc-badge mt-2">Locale · non verificato</span>
            {scan.simulated && (
              <span className="nfc-badge sim mt-2 ml-2">Tag simulato</span>
            )}
            <p className="nfc-muted mt-2">UID {scan.uid}</p>
          </div>
        </div>
        {step === 0 ? (
          recognized ? (
            <>
              <p className="text-sm text-ink-muted">
                Rilevato <strong>{name}</strong>. Vuoi caricarlo nel canvas Run Deploy
                sulla Backbone per poterlo usare?
              </p>
              {targets.length > 1 && (
                <label className="nfc-field">
                  Backbone di destinazione
                  <select
                    aria-label="Backbone di destinazione"
                    value={bindingId}
                    onChange={(e) => setBindingId(e.target.value)}
                  >
                    <option value="">Scegli la Backbone</option>
                    {targets.map((b) => (
                      <option key={b.bindingId} value={b.bindingId}>
                        {rows.find((r) => r.binding.bindingId === b.bindingId)
                          ?.displayName ?? b.expectedDeviceId}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!targets.length && (
                <p className="nfc-info">
                  Aggiungi una Backbone in Discover prima di caricare il modulo.
                </p>
              )}
              {driver?.draft.binding.bus === "gpio" && (
                <GpioPinField pins={gpioPins} value={gpioValue} onChange={setGpioValue} />
              )}
              {error && (
                <p role="alert" className="nfc-info nfc-error mt-4">
                  {error}
                </p>
              )}
              <div className="nfc-actions">
                <button
                  type="button"
                  className="nfc-btn"
                  onClick={() => nfc.dismissModule()}
                >
                  No
                </button>
                <button
                  type="button"
                  className="nfc-btn primary"
                  disabled={!driver || !target}
                  onClick={confirm}
                >
                  <CircuitBoard size={16} />
                  Sì, carica
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-muted">
                Vuoi caricare questo modulo nel canvas?
              </p>
              <label className="nfc-field">
                Backbone di destinazione
                <select
                  aria-label="Backbone di destinazione"
                  value={bindingId}
                  onChange={(e) => setBindingId(e.target.value)}
                >
                  <option value="">Scegli la Backbone</option>
                  {targets.map((b) => (
                    <option key={b.bindingId} value={b.bindingId}>
                      {rows.find((r) => r.binding.bindingId === b.bindingId)
                        ?.displayName ?? b.expectedDeviceId}
                    </option>
                  ))}
                </select>
              </label>
              {!targets.length && (
                <p className="nfc-info">
                  Aggiungi una Backbone in Discover prima di caricare il modulo.
                </p>
              )}
              <label className="nfc-field">
                Driver associato
                <select
                  aria-label="Driver del modulo"
                  value={driverValue}
                  onChange={(e) => {
                    if (e.target.value === "__create") nfc.createDriver(scan, name);
                    else setDriverValue(e.target.value);
                  }}
                >
                  <DriverOptions />
                </select>
              </label>
              {driver ? (
                <div className="nfc-info nfc-success">
                  <Check size={15} className="inline mr-2" />
                  Driver disponibile in locale · {driver.draft.name}
                </div>
              ) : (
                <>
                  <p className="nfc-info">
                    Nessun driver utilizzabile associato. Scegline uno o seleziona “Crea
                    driver” nel menu.
                  </p>
                  <p className="nfc-muted mt-3">{remoteDriverCatalog.status}</p>
                </>
              )}
              <label className="nfc-field">
                Alimentazione richiesta dal modulo
                <select
                  aria-label="Alimentazione modulo"
                  value={voltage}
                  onChange={(e) => setVoltage(e.target.value as typeof voltage)}
                >
                  <option value="">Verifica nella documentazione del modulo</option>
                  <option value="3.3V">3.3 V</option>
                  <option value="5V">5 V · segnali compatibili con 3.3 V</option>
                </select>
              </label>
              {driver?.draft.binding.bus === "gpio" && (
                <GpioPinField pins={gpioPins} value={gpioValue} onChange={setGpioValue} />
              )}
              <div className="nfc-actions">
                <button
                  type="button"
                  className="nfc-btn"
                  onClick={() => {
                    nfc.dismissModule();
                    nfc.openTag(scan.id);
                  }}
                >
                  Dettagli del tag
                </button>
                <button
                  type="button"
                  className="nfc-btn primary"
                  disabled={!driver || !target || !voltage}
                  onClick={() => {
                    associate();
                    setStep(1);
                  }}
                >
                  Carica nel canvas
                </button>
              </div>
            </>
          )
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Collega {name} alla Backbone selezionata, poi conferma.
            </p>
            {driver?.draft.binding.bus === "gpio" && (
              <GpioPinField pins={gpioPins} value={gpioValue} onChange={setGpioValue} />
            )}
            {wiring ? (
              <>
                <p className="nfc-muted mt-3">
                  Connettore Function {wiring.variant.toUpperCase()} ·{" "}
                  {wiring.physical.name}
                </p>
                <div
                  className="nfc-connector"
                  aria-label="Disposizione fisica del connettore"
                >
                  {functionPinGrid(wiring.physical.modes, wiring.variant).map(
                    (row, index) => (
                      <div className="nfc-connector-row" key={index}>
                        {row.map((cell, i) => (
                          <div
                            key={i}
                            className={
                              wiring.lines.some(
                                (l) =>
                                  l.pin ===
                                  (cell.modeIndex === undefined
                                    ? cell.label
                                    : formatPinLabel(
                                        modeIndexToPinId(
                                          cell.modeIndex,
                                          wiring.variant,
                                        ),
                                        wiring.variant,
                                      )),
                              )
                                ? "connected"
                                : ""
                            }
                          >
                            <span>●</span>
                            <strong>
                              {cell.modeIndex === undefined
                                ? cell.label
                                : formatPinLabel(
                                    modeIndexToPinId(cell.modeIndex, wiring.variant),
                                    wiring.variant,
                                  )}
                            </strong>
                            <small>
                              {cell.modeIndex === undefined ? "" : cell.label}
                            </small>
                          </div>
                        ))}
                      </div>
                    ),
                  )}
                  <p>Vista lato contatti · rispetta l’orientamento della serigrafia</p>
                </div>
                <svg
                  className="nfc-wire"
                  viewBox="0 0 520 200"
                  role="img"
                  aria-label={`Collegamenti ${wiring.variant}: ${wiring.lines.map((l) => `${l.signal} al pin ${l.pin}`).join(", ")}`}
                >
                  <rect
                    x="8"
                    y="8"
                    width="125"
                    height="184"
                    rx="12"
                    fill="#f2f6ff"
                    stroke="#cad7ee"
                  />
                  <rect
                    x="387"
                    y="8"
                    width="125"
                    height="184"
                    rx="12"
                    fill="#f2f6ff"
                    stroke="#cad7ee"
                  />
                  <text x="22" y="30">
                    {wiring.variant.toUpperCase()} · Backbone
                  </text>
                  <text x="402" y="30">
                    Modulo
                  </text>
                  {wiring.lines.map((line, i) => (
                    <g key={line.signal}>
                      <text x="24" y={61 + i * 34}>
                        {line.pin}
                      </text>
                      <path d={`M133 ${56 + i * 34} H387`} />
                      <circle cx="133" cy={56 + i * 34} r="4" />
                      <circle cx="387" cy={56 + i * 34} r="4" />
                      <text x="402" y={61 + i * 34}>
                        {line.signal}
                      </text>
                    </g>
                  ))}
                </svg>
                <table className="nfc-table">
                  <thead>
                    <tr>
                      <th>Segnale modulo</th>
                      <th>Pin Backbone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wiring.lines.map((l) => (
                      <tr key={l.signal}>
                        <td>{l.signal}</td>
                        <td>{l.pin}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="nfc-muted mt-4">
                  La porta I²C risulta già applicata. L’inserimento prepara il Flow;
                  l’esecuzione si avvia da Run Deploy.
                </p>
              </>
            ) : (
              <>
                <p role="alert" className="nfc-info nfc-error mt-4">
                  {wiringError}
                </p>
                <button
                  type="button"
                  className="nfc-btn mt-4"
                  onClick={() => {
                    if (target) {
                      nfc.dismissModule();
                      openBackbonePhysical(bindingId, target.expectedDeviceId);
                    }
                  }}
                >
                  <ExternalLink size={16} />
                  Apri configuratore pin
                </button>
              </>
            )}
            {error && (
              <p role="alert" className="nfc-info nfc-error mt-4">
                {error}
              </p>
            )}
            <div className="nfc-actions">
              <button type="button" className="nfc-btn" onClick={() => setStep(0)}>
                <ArrowLeft size={15} />
                Indietro
              </button>
              <button
                type="button"
                className="nfc-btn primary"
                disabled={!wiring}
                onClick={confirm}
              >
                <CircuitBoard size={16} />
                OK, connesso
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GpioPinField({
  pins,
  value,
  onChange,
}: {
  readonly pins: readonly { readonly boardKey: string; readonly channel: number; readonly label: string }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const selected = value || (pins[0] ? `${pins[0].boardKey}:${pins[0].channel}` : "");
  return (
    <label className="nfc-field">
      Pin GPIO (comando relè)
      <select aria-label="Pin GPIO del relè" value={selected} onChange={(e) => onChange(e.target.value)}>
        {!pins.length && <option value="">Nessun GPIO OUT in Module Function</option>}
        {pins.map((pin) => (
          <option key={`${pin.boardKey}:${pin.channel}`} value={`${pin.boardKey}:${pin.channel}`}>
            {pin.label}
          </option>
        ))}
      </select>
    </label>
  );
}
