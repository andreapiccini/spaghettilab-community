import { useState } from "react";
import { settingsSecurityCopy } from "../../lib/settings-security-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { useUiMode } from "../../state/ui-mode-context.js";
import { AuditTab } from "./AuditTab.js";
import { BackupVersionsTab } from "./BackupVersionsTab.js";
import { CredentialsTab } from "./CredentialsTab.js";
import { ImportExportTab } from "./ImportExportTab.js";
import { InterfaceTab } from "./InterfaceTab.js";
import { PermissionsTab } from "./PermissionsTab.js";
import { RecoveryTab } from "./RecoveryTab.js";

const BASE_TAB_IDS = ["interfaccia", "credenziali", "backup", "import-export"] as const;
const ADVANCED_TAB_IDS = ["permessi", "audit", "recovery"] as const;
type TabId = (typeof BASE_TAB_IDS)[number] | (typeof ADVANCED_TAB_IDS)[number];

/**
 * `ux/screens/S120-settings-security/{visual,ui-behavior,backend-behavior}.md`,
 * cablato su `@spaghettilab/security-recovery` (S124), `domain/permission.ts`
 * (S121), `project-store`'s `ProjectAutosaveStore` (S122) e
 * `domain/project-import-export.ts` (S123) — tutti reali, contrariamente alla
 * nota "⬜ TODO" stantia del `backend-behavior.md` (S121-S124 sono tutti
 * ✅ DONE nel roadmap backend, stesso pattern visto per ogni screen
 * precedente tranne S104). Permessi/Audit/Recovery restano nascosti in
 * modalità base (S125), come i visual.md richiede.
 */
export function SettingsSecurityScreen() {
  const { mode } = useUiMode();
  const { locale } = useLocale();
  const copy = settingsSecurityCopy(locale);
  const [tab, setTab] = useState<TabId>("interfaccia");
  const tabLabels: Record<TabId, string> = {
    interfaccia: copy.tabs.interface,
    credenziali: copy.tabs.credentials,
    backup: copy.tabs.backup,
    "import-export": copy.tabs.importExport,
    permessi: copy.tabs.permissions,
    audit: copy.tabs.audit,
    recovery: copy.tabs.recovery,
  };
  const tabs = (mode === "advanced" ? [...BASE_TAB_IDS, ...ADVANCED_TAB_IDS] : BASE_TAB_IDS).map((id) => ({
    id,
    label: tabLabels[id],
  }));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <h1 className="font-heading text-lg font-semibold text-ink">{copy.title}</h1>
      </div>

      <div className="flex shrink-0 flex-wrap gap-1 border-b border-border bg-surface px-4">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className="flex items-center gap-1.5 border-b-2 px-3 py-2.5 font-body text-sm" style={{ borderColor: active ? "var(--color-brand-blue)" : "transparent", color: active ? "var(--color-brand-blue)" : "var(--color-ink-muted)" }}>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto">
        {tab === "interfaccia" && <InterfaceTab />}
        {tab === "credenziali" && <CredentialsTab />}
        {tab === "backup" && <BackupVersionsTab />}
        {tab === "import-export" && <ImportExportTab />}
        {tab === "permessi" && <PermissionsTab />}
        {tab === "audit" && <AuditTab />}
        {tab === "recovery" && <RecoveryTab />}
      </div>
    </div>
  );
}
