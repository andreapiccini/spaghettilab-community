import { proposeBindingFromDiscovery } from "@spaghettilab/core-session";
import { addCoreBinding, connectionProfileId, coreBindingId, createConnectionProfile, type CoreBindingRecord } from "@spaghettilab/domain";
import { SpaghettiClient, WebSocketProtocolTransport } from "@spaghettilab/protocol-sdk";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { connectBrowserWebSocket } from "../../lib/browser-websocket-connection.js";
import { saveConnectionProfile } from "../../lib/connection-profile-store.js";
import { coreDisplayName, identityFromStatus } from "../../lib/core-identity.js";
import { coreConnectionsCopy } from "../../lib/core-connections-copy.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import { probeUsbCores, requestUsbCorePort, usbSerialSupported, type FoundUsbCore } from "../../lib/probe-usb-cores.js";
import { uuidGenerator } from "../../lib/repository.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import type { CoreLink } from "../../state/core-sessions-context.js";

type Method = "auto" | "network" | "usb";

export function ConnectCoreDialog({
  open,
  onClose,
  onConnect,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConnect: (binding: CoreBindingRecord, link: CoreLink) => void;
}) {
  const { session, execute } = useSession();
  const { locale } = useLocale();
  const copy = coreConnectionsCopy(locale);
  const [method, setMethod] = useState<Method>("auto");
  const [nickname, setNickname] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usbCores, setUsbCores] = useState<readonly FoundUsbCore[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const addressValid = /^wss?:\/\/.+/.test(address.trim());
  const selectedUsb = usbCores.filter((core) => selectedIds.has(core.deviceIdHex));
  const canConnect =
    !busy &&
    ((method === "network" && addressValid) ||
      ((method === "auto" || method === "usb") && selectedUsb.length > 0));

  useEffect(() => {
    if (!open || (method !== "auto" && method !== "usb")) return undefined;
    let cancelled = false;
    void probeUsbCores()
      .then((found) => {
        if (cancelled) return;
        setUsbCores(found);
        setSelectedIds(new Set(found.map((core) => core.deviceIdHex)));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(localizeUsbError(cause, copy));
      });
    return () => {
      cancelled = true;
    };
  }, [open, method]);

  async function addUsbPort() {
    setBusy(true);
    setError(null);
    try {
      const core = await requestUsbCorePort();
      if (!core) return;
      setUsbCores((prev) => {
        if (prev.some((item) => item.deviceIdHex === core.deviceIdHex)) return prev;
        return [...prev, core];
      });
      setSelectedIds((prev) => new Set([...prev, core.deviceIdHex]));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "NotFoundError") return;
      setError(localizeUsbError(cause, copy));
    } finally {
      setBusy(false);
    }
  }

  async function bindAndConnect(bindingInput: {
    deviceIdHex: string;
    displayName: string;
    link: CoreLink;
    transport: "usb" | "websocket";
    host: string;
    port: number;
  }): Promise<void> {
    if (!execute || !session) return;
    const existing = session.stack.current.coreBindings.find((b) => b.expectedDeviceId === bindingInput.deviceIdHex);
    if (existing) {
      onConnect(existing, bindingInput.link);
      return;
    }

    const profileIdResult = connectionProfileId(uuidGenerator.generate());
    const bindingIdResult = coreBindingId(uuidGenerator.generate());
    if (!profileIdResult.ok || !bindingIdResult.ok) return;

    const profileResult = createConnectionProfile({
      connectionProfileId: profileIdResult.value,
      name: bindingInput.displayName,
      transport: bindingInput.transport,
      host: bindingInput.host,
      port: bindingInput.port,
    });
    if (!profileResult.ok) {
      setError(profileResult.error.map((e) => e.remediation).join(" "));
      return;
    }
    await saveConnectionProfile(profileResult.value);

    const proposed = proposeBindingFromDiscovery(
      session.stack.current.coreBindings,
      { expectedDeviceId: bindingInput.deviceIdHex, connectionProfileId: profileResult.value.connectionProfileId },
      bindingIdResult.value,
    );
    if (proposed.bindingId !== bindingIdResult.value) {
      onConnect(proposed, bindingInput.link);
      return;
    }

    const result = execute(addCoreBinding(proposed));
    if (!result.ok) return;
    onConnect(proposed, bindingInput.link);
  }

  async function handleConnect() {
    if (!canConnect) return;
    setBusy(true);
    setError(null);
    try {
      if (method === "network") {
        const url = address.trim();
        const parsed = new URL(url);
        const { connection, socket } = await connectBrowserWebSocket(url);
        const transport = new WebSocketProtocolTransport(connection);
        const client = new SpaghettiClient(transport, { defaultTimeoutMs: 5000, maxRetries: 0 });
        try {
          const status = await client.getStatus();
          const identity = identityFromStatus(status, `ws-${parsed.hostname}`);
          const displayName = nickname.trim() || coreDisplayName(identity.deviceName, identity.deviceIdHex);
          await bindAndConnect({
            deviceIdHex: identity.deviceIdHex,
            displayName,
            link: { kind: "websocket", url },
            transport: "websocket",
            host: parsed.hostname,
            port: parsed.port !== "" ? Number(parsed.port) : parsed.protocol === "wss:" ? 443 : 80,
          });
        } finally {
          client.dispose();
          transport.dispose();
          socket.close();
        }
      } else {
        const nick = nickname.trim();
        for (const core of selectedUsb) {
          const displayName = selectedUsb.length === 1 && nick ? nick : coreDisplayName(core.deviceName, core.deviceIdHex);
          await bindAndConnect({
            deviceIdHex: core.deviceIdHex,
            displayName,
            link: core.source === "bridge" ? { kind: "websocket", url: core.url } : { kind: "usb", port: core.port },
            transport: "usb",
            host: core.deviceIdHex,
            port: 1,
          });
        }
      }
      setNickname("");
      setAddress("");
      onClose();
    } catch (cause) {
      setError(localizeUsbError(cause, copy));
    } finally {
      setBusy(false);
    }
  }

  function toggleUsb(deviceIdHex: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(deviceIdHex)) next.delete(deviceIdHex);
      else next.add(deviceIdHex);
      return next;
    });
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex justify-center bg-[rgba(20,23,31,.35)] pt-24" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTokens.duration.base} onClick={onClose}>
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={motionTokens.spring.smooth} onClick={(e) => e.stopPropagation()} className="h-fit w-[520px] rounded-sllg bg-surface p-6 shadow-e3">
            <h2 className="mb-4 font-heading text-lg font-semibold">{copy.dialogTitle}</h2>

            <label className="mb-1 block font-body text-sm font-semibold text-ink" htmlFor="core-nickname">
              {copy.nicknameLabel}
            </label>
            <input
              id="core-nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={copy.nicknamePlaceholder}
              className="mb-4 w-full rounded-slsm border border-border-strong px-3 py-2 font-body text-sm outline-none"
            />

            <div className="mb-4 flex gap-1 rounded-slpill bg-surface-raised p-1">
              {(
                [
                  ["auto", "Auto"],
                  ["network", copy.methodNetwork],
                  ["usb", copy.methodUsb],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMethod(id)}
                  className={`flex-1 rounded-slpill py-1.5 text-sm font-body ${method === id ? "bg-surface shadow-e1" : "text-ink-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {method === "network" ? (
                <motion.div key="network" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTokens.duration.fast}>
                  <label className="mb-1 block font-body text-sm font-semibold text-ink" htmlFor="core-address">
                    {copy.websocketAddress}
                  </label>
                  <input id="core-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ws://192.168.1.42:8765" className="w-full rounded-slsm border border-border-strong px-3 py-2 font-mono text-sm outline-none" />
                </motion.div>
              ) : (
                <motion.div key="usb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTokens.duration.fast}>
                  {usbCores.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-slsm bg-surface-sunken py-8 text-center">
                      <p className="font-body text-sm text-ink-muted">
                        {method === "auto" ? copy.noCoreFound : copy.noUsbCore}
                      </p>
                      <p className="max-w-80 font-body text-xs text-ink-faint">
                        {!usbSerialSupported()
                          ? copy.safariUsbHelp
                          : method === "auto"
                            ? copy.autoHelp
                            : copy.usbHelp}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          void probeUsbCores()
                            .then((found) => {
                              setUsbCores(found);
                              setSelectedIds(new Set(found.map((core) => core.deviceIdHex)));
                            })
                            .catch((cause: unknown) => {
                              setError(localizeUsbError(cause, copy));
                            });
                        }}
                        className="mt-1 font-body text-xs text-brand-blue hover:underline"
                      >
                        {copy.retry}
                      </button>
                    </div>
                  ) : (
                    <ul className="flex max-h-56 flex-col gap-1 overflow-auto">
                      {usbCores.map((core, index) => (
                        <li key={core.deviceIdHex}>
                          <label
                            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-slsm px-3 hover:bg-surface-raised"
                            style={{ animationDelay: `${index * 30}ms` }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedIds.has(core.deviceIdHex)}
                              onChange={() => toggleUsb(core.deviceIdHex)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-body text-sm font-semibold text-ink">
                                {coreDisplayName(core.deviceName, core.deviceIdHex)}
                              </span>
                              <span className="block truncate font-mono text-xs text-ink-faint">
                                core://{core.deviceIdHex}
                                {core.version ? ` · ${core.version}` : ""}
                                {core.source === "bridge" ? ` · ${copy.localBridge}` : ""}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  {method === "usb" && usbSerialSupported() && (
                    <button type="button" onClick={() => void addUsbPort()} disabled={busy} className="mt-3 w-full rounded-slsm border border-border-strong py-2 font-body text-sm text-ink hover:bg-surface-raised disabled:opacity-50">
                      {copy.addUsbPort}
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            {error && <p className="mt-2 font-body text-xs text-error">{error}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-slsm px-4 py-2 font-body text-sm text-ink-muted hover:bg-surface-raised">
                {copy.cancel}
              </button>
              <button type="button" onClick={() => void handleConnect()} disabled={!canConnect} className="rounded-slsm bg-brand-blue px-4 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:opacity-50">
                {busy ? copy.connecting : selectedUsb.length > 1 && method !== "network" ? copy.connectCount(selectedUsb.length) : copy.connect}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function localizeUsbError(cause: unknown, copy: ReturnType<typeof coreConnectionsCopy>): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message === "usb-serial-unavailable") return copy.usbSerialUnavailable;
  if (message === "usb-not-a-core") return copy.usbNotACore;
  return message;
}
