import { PERMISSION_SCOPES } from "@spaghettilab/domain";
import { CheckCircle2 } from "lucide-react";
import { settingsSecurityCopy } from "../../lib/settings-security-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { PLACEHOLDER_GRANTED_ALL } from "../runtime-diagnostics/permission-placeholder.js";

/**
 * `ux/screens/S120-settings-security/visual.md` § Permessi — matrice locale
 * di `domain/permission.ts`'s `PERMISSION_SCOPES` (S121, reale, 13 scope).
 * Gap dichiarato: nessun sistema di login/multi-principal esiste ancora
 * (materia di `ecosystem-access-v1`) — questa è esattamente la schermata
 * che avrebbe dovuto introdurre una fonte reale di `PermissionSet`, ma
 * quel sistema non esiste; qui si riusa lo stesso placeholder "tutti gli
 * scope concessi" già introdotto per Runtime & Diagnostics, invece di
 * duplicarne uno diverso.
 */
export function PermissionsTab() {
  const { locale } = useLocale();
  const copy = settingsSecurityCopy(locale);
  const granted = PLACEHOLDER_GRANTED_ALL;
  const groups: { readonly label: string; readonly prefix: string }[] = [
    { label: "Core", prefix: "core." },
    { label: "Node-RED", prefix: "nodered." },
    { label: copy.projectGroup, prefix: "project." },
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <p className="font-body text-sm text-ink-muted">
        {copy.permissionsGap}
      </p>
      {groups.map((g) => (
        <div key={g.prefix}>
          <h2 className="font-heading text-sm font-semibold text-ink">{g.label}</h2>
          <div className="mt-2 flex flex-col gap-1">
            {PERMISSION_SCOPES.filter((s) => s.startsWith(g.prefix)).map((scope) => (
              <div key={scope} className="flex items-center gap-2 rounded-slsm border border-border p-2 font-mono text-xs">
                <span className="text-ink">{scope}</span>
                <span className="ml-auto flex items-center gap-1 rounded-slpill px-2 py-0.5" style={{ backgroundColor: granted.has(scope) ? "color-mix(in srgb, var(--color-success) 12%, transparent)" : "color-mix(in srgb, var(--color-error) 12%, transparent)", color: granted.has(scope) ? "var(--color-success)" : "var(--color-error)" }}>
                  {granted.has(scope) && <CheckCircle2 size={11} />}
                  {granted.has(scope) ? copy.granted : copy.missingPermission}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
