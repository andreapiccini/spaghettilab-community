import { deviceProfileCopy } from "../../lib/device-profile-copy.js";
import { useLocale } from "../../state/locale-context.js";

/**
 * `ux/screens/S060-device-profile-studio/visual.md` § Tab Metadata. `DeviceProfileDraft`
 * (`@spaghettilab/device-profile-authoring-model`) has no `name`/`author`/
 * `description` fields at all — mirrors `struct spaghetti_device_profile` exactly,
 * which has none either. "Nome" and "Descrizione" here are UI-only labels (Nome
 * persisted via `AuthoringMetadata.comment`, same pattern already used for
 * Physical Composition nodes; Descrizione has nowhere to persist at all — genuine
 * gap, kept as session-local state only, never silently dropped without saying so).
 * "Autore" is real: it becomes `DeviceProfilePackage.author` on save.
 */
export function MetadataTab({
  label,
  onLabel,
  profileId,
  idLocked,
  onProfileId,
  version,
  onVersion,
  author,
  onAuthor,
  description,
  onDescription,
}: {
  readonly label: string;
  readonly onLabel: (v: string) => void;
  readonly profileId: string;
  readonly idLocked: boolean;
  readonly onProfileId: (v: string) => void;
  readonly version: number;
  readonly onVersion: (v: number) => void;
  readonly author: string;
  readonly onAuthor: (v: string) => void;
  readonly description: string;
  readonly onDescription: (v: string) => void;
}) {
  const { locale } = useLocale();
  const copy = deviceProfileCopy(locale);
  return (
    <div className="flex max-w-xl flex-col gap-4 p-6">
      <div>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="dps-name">
          {copy.name}
        </label>
        <input id="dps-name" value={label} onChange={(e) => onLabel(e.target.value)} placeholder={copy.temperaturePlaceholder} className="w-full rounded-slsm border border-border-strong px-3 py-2 font-body text-sm outline-none" />
      </div>
      <div>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="dps-id">
          ID {idLocked && <span className="font-normal text-ink-faint">{copy.readOnlyAfterSave}</span>}
        </label>
        <input id="dps-id" value={profileId} onChange={(e) => onProfileId(e.target.value)} disabled={idLocked} placeholder="sensor.example" className="w-full rounded-slsm border border-border-strong px-3 py-2 font-mono text-sm outline-none disabled:bg-surface-sunken disabled:text-ink-faint" />
      </div>
      <div>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="dps-version">
          {copy.version}
        </label>
        <input id="dps-version" type="number" value={version} onChange={(e) => onVersion(Number(e.target.value))} className="w-full rounded-slsm border border-border-strong px-3 py-2 font-mono text-sm outline-none" />
      </div>
      <div>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="dps-author">
          {copy.author}
        </label>
        <input id="dps-author" value={author} onChange={(e) => onAuthor(e.target.value)} className="w-full rounded-slsm border border-border-strong px-3 py-2 font-body text-sm outline-none" />
      </div>
      <div>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="dps-desc">
          {copy.description} <span className="font-normal text-ink-faint">{locale === "en" ? "(not persisted — no field for this in the current model)" : "(non persistita — nessun campo per questo nel modello attuale)"}</span>
        </label>
        <textarea id="dps-desc" value={description} onChange={(e) => onDescription(e.target.value)} rows={4} className="w-full rounded-slsm border border-border-strong px-3 py-2 font-body text-sm outline-none" />
      </div>
    </div>
  );
}
