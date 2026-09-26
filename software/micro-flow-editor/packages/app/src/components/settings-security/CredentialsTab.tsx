import { InMemoryCredentialStore, type ConnectionProfile } from "@spaghettilab/domain";
import { confirmCredentialRemoval } from "@spaghettilab/security-recovery";
import { KeyRound, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { listConnectionProfiles, removeConnectionProfile } from "../../lib/connection-profile-store.js";
import { settingsSecurityCopy } from "../../lib/settings-security-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

const credentialStore = new InMemoryCredentialStore();

/**
 * `ux/screens/S120-settings-security/visual.md` § Credenziali. Gap dichiarato,
 * doppio: (1) nessuna schermata di questa app scrive mai un `credentialRef`
 * su un `ConnectionProfile` — `ConnectCoreDialog.tsx` non ha alcun campo
 * credenziali — quindi questa lista è vuota finché quel flusso non esiste;
 * (2) nessun adattatore `CredentialStore` persistente esiste per il browser
 * (localStorage in chiaro non è un posto sicuro per un segreto) — qui è
 * usato `InMemoryCredentialStore`, dichiaratamente non persistente (perso al
 * reload), non un fake spacciato per reale.
 */
export function CredentialsTab() {
  const { locale } = useLocale();
  const copy = settingsSecurityCopy(locale);
  const [profiles, setProfiles] = useState<readonly ConnectionProfile[]>([]);
  const [pending, setPending] = useState<ConnectionProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listConnectionProfiles().then(setProfiles);
  }, []);

  const withCredentials = profiles.filter((p) => p.credentialRef);

  async function handleRemove(profile: ConnectionProfile, confirmedTarget: string) {
    if (!profile.credentialRef) return;
    const target = profile.credentialRef;
    const result = await confirmCredentialRemoval(credentialStore, new Uint8Array(0), target, { target, confirmedTarget });
    if (!result.ok) {
      setError(result.error.remediation);
      return;
    }
    await removeConnectionProfile(profile.connectionProfileId);
    setProfiles((prev) => prev.filter((p) => p.connectionProfileId !== profile.connectionProfileId));
    setPending(null);
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <p className="font-body text-sm text-ink-muted">{copy.credentialsBody}</p>
      {error && <p className="font-body text-sm text-error">{error}</p>}

      {withCredentials.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <KeyRound size={40} className="text-ink-faint" />
          <p className="font-body text-sm text-ink-muted">{copy.noCredentials}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {withCredentials.map((p) => (
            <div key={p.connectionProfileId} className="flex items-center gap-3 rounded-slmd border border-border p-3">
              <KeyRound size={16} className="text-ink-faint" />
              <div className="flex-1">
                <p className="font-body text-sm font-semibold text-ink">{p.name}</p>
                <p className="font-mono text-xs text-ink-faint">{p.credentialRef}</p>
              </div>
              <button type="button" onClick={() => setPending(p)} className="flex items-center gap-1 rounded-slsm border border-border-strong px-2 py-1 font-body text-xs text-error hover:bg-surface-raised">
                <Trash2 size={12} />
                {copy.remove}
              </button>
            </div>
          ))}
        </div>
      )}

      {pending?.credentialRef && <ConfirmDialog target={pending.credentialRef} onCancel={() => setPending(null)} onConfirm={(typed) => void handleRemove(pending, typed)} />}
    </div>
  );
}
