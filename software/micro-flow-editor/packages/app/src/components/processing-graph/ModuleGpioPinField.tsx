import {
  isGpioModule,
  type BackboneSensorModule,
} from "../../lib/backbone-sensor-modules.js";
import { useState, useEffect, useRef } from "react";
import { ModulesScreen } from "../modules/ModulesScreen.js";
import { useSession } from "../../state/session-context.js";

/** Pin ownership is configured centrally in Modules, never from a canvas block. */
export function ModuleGpioPinField({
  module,
  bindingId,
  it,
}: {
  readonly module: BackboneSensorModule;
  readonly bindingId: string;
  readonly it: boolean;
}) {
  const { navigate } = useSession();
  const [editing, setEditing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!editing) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [editing]);
  if (!isGpioModule(module)) return null;
  const draft = module.recipe.deviceDraft;
  const channels =
    module.gpioAssignments?.channels ??
    (module.gpioAssignment
      ? { [draft?.binding.gpioSignals[0]?.id ?? "DATA"]: module.gpioAssignment.channel }
      : {});
  const boardKey = module.gpioAssignments?.boardKey ?? module.gpioAssignment?.boardKey;
  return (
    <section
      className="rounded-xl border border-border p-3 font-body text-sm"
      data-binding={bindingId}
    >
      <h3 className="mb-2 font-semibold">
        {it ? "Collegamenti del modulo" : "Module connections"}
      </h3>
      <dl>
        {Object.entries(channels).map(([signal, channel]) => (
          <div key={signal} className="flex justify-between py-1">
            <dt>
              {draft?.binding.gpioSignals.find((item) => item.id === signal)?.name ??
                signal}
            </dt>
            <dd className="font-mono text-brand-blue">A{channel}</dd>
          </div>
        ))}
      </dl>
      {!Object.keys(channels).length && (
        <p className="text-ink-muted">
          {it ? "Pin da scegliere in Moduli." : "Choose pins in Modules."}
        </p>
      )}
      {draft?.temperatureSensorModel === "ds18b20" && (
        <p className="mt-2 text-xs text-ink-muted">
          {draft.ds18b20PowerMode === "parasite"
            ? "Alimentazione parassita · GND comune"
            : "VCC 3,3 V · GND comune"}
        </p>
      )}
      <button
        type="button"
        className="mt-2 text-xs font-semibold text-brand-blue hover:underline"
        onClick={() => draft && boardKey ? setEditing(true) : navigate("modules")}
      >
        {it ? "Cambia pin o Backbone" : "Change pins or Backbone"}
      </button>
      {editing && draft && boardKey && <dialog ref={dialog}
        aria-label="Pin e Backbone del modulo" onCancel={event => { event.preventDefault(); setEditing(false); }}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-ink backdrop:bg-black/20">
        <ModulesScreen nfcImport={{
        driver: draft, uid: module.id, bindingId,
        editingModule: { id: module.id, boardKey, channels },
        onClose: () => setEditing(false),
      }} /></dialog>}
    </section>
  );
}
