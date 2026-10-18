import { Bell, Radio, X, Volume2, VolumeX, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNfcWorkspace } from "../../state/nfc-workspace-context.js";
import { useSession } from "../../state/session-context.js";
import "./nfc.css";
export function NfcBell() {
  const nfc = useNfcWorkspace();
  const { navigate } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = nfc.history.filter((s) => !s.read).length;
  useEffect(() => {
    if (!open) return;
    function close(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="nfc-bell" ref={ref}>
      <button
        type="button"
        className="nfc-bell-button"
        aria-label={`Notifiche${unread ? `, ${unread} non lette` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={19} />
        {unread > 0 && (
          <span className="nfc-bell-count">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <section className="nfc-notifications" aria-label="Notifiche">
          <header>
            <strong>Notifiche</strong>
            <button type="button" className="nfc-text-button" onClick={nfc.markAllRead}>
              Segna tutte come lette
            </button>
          </header>
          {nfc.history.length === 0 ? (
            <p className="nfc-empty">Nessuna scansione. Avvicina un tag al lettore.</p>
          ) : (
            nfc.history
              .filter((s) => !s.source || s.source === "scan")
              .slice(0, 30)
              .map((scan) => (
                <button
                  type="button"
                  key={scan.id}
                  className={`nfc-notification ${scan.read ? "" : "unread"}`}
                  onClick={() => {
                    nfc.openTag(scan.id);
                    setOpen(false);
                  }}
                >
                  <Radio size={20} className="shrink-0 text-brand-blue" />
                  <div>
                    <strong>
                      {scan.decoded.kind === "module"
                        ? "Tag modulo rilevato"
                        : scan.decoded.kind === "empty"
                          ? "Tag vuoto rilevato"
                          : "Tag letto"}
                      {scan.simulated ? " · simulazione" : ""}
                    </strong>
                    <p>{scan.name}</p>
                    <small>
                      {scan.reader} ·{" "}
                      {new Date(scan.at).toLocaleTimeString("it-IT", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </div>
                </button>
              ))
          )}
          <div className="flex items-center justify-between p-4">
            <button
              className="nfc-text-button flex items-center gap-2"
              type="button"
              onClick={() => {
                navigate("nfc-tags");
                setOpen(false);
              }}
            >
              <ArrowRight size={16} />
              Apri Tag NFC
            </button>
            <button
              className="nfc-icon-button"
              type="button"
              aria-label={
                nfc.sound ? "Disattiva suono notifiche" : "Attiva suono notifiche"
              }
              title={nfc.sound ? "Disattiva suono" : "Attiva suono"}
              onClick={() => nfc.setSound(!nfc.sound)}
            >
              {nfc.sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
export function NfcToast() {
  const nfc = useNfcWorkspace();
  const scan = nfc.toast;
  if (!scan) return null;
  return (
    <div role="status" className="nfc-toast">
      <Radio size={23} className="text-brand-blue" />
      <button
        type="button"
        className="text-left"
        onClick={() => {
          nfc.openTag(scan.id);
          nfc.dismissToast();
        }}
      >
        <strong>
          {scan.name}
          {scan.simulated ? " · simulazione" : ""}
        </strong>
        <p>Tag NFC rilevato · Apri i dettagli</p>
      </button>
      <button
        type="button"
        className="nfc-icon-button"
        aria-label="Chiudi notifica"
        onClick={nfc.dismissToast}
      >
        <X size={16} />
      </button>
    </div>
  );
}
