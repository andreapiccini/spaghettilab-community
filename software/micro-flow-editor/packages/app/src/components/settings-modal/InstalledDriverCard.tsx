import { useState, type ReactNode } from "react";
import { catalogTopologyCopy } from "../../lib/catalog-topology-copy.js";
import { localizeCompositionLabel } from "../../lib/physical-protocol-copy.js";
import { useLocale } from "../../state/locale-context.js";
import {
  compositionLines,
  contentForInstalledDriver,
  type DriverSchemaField,
  type InstalledDriverContent,
} from "../../lib/port-protocol-mock.js";

export function InstalledDriverCard({
  typeId,
  commandCount,
  profiles,
}: {
  readonly typeId: string;
  readonly commandCount: number;
  readonly profiles?: readonly { readonly profileId: string; readonly version: number }[];
}) {
  const { locale } = useLocale();
  const copy = catalogTopologyCopy(locale);
  const [open, setOpen] = useState(false);
  const content = contentForInstalledDriver(typeId);
  return (
    <div className="rounded-slmd border border-border bg-surface px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm text-ink">{typeId}</p>
          <p className="font-body text-xs text-ink-faint">
            {copy.presentOnCore(commandCount)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="shrink-0 rounded-slsm border border-border-strong px-2 py-1 font-body text-[11px] text-ink hover:bg-surface-raised"
        >
          {open ? copy.close : copy.read}
        </button>
      </div>
      {open && <InstalledDriverBody content={content} commandCount={commandCount} profiles={profiles ?? []} />}
    </div>
  );
}

function InstalledDriverBody({
  content,
  commandCount,
  profiles,
}: {
  readonly content: InstalledDriverContent;
  readonly commandCount: number;
  readonly profiles: readonly { readonly profileId: string; readonly version: number }[];
}) {
  const settings = content.protocol?.settings;
  return (
    <div className="mt-2 flex flex-col gap-2.5 rounded-slsm bg-surface-sunken px-2.5 py-2">
      <div>
        <p className="font-body text-xs font-semibold text-ink">{content.name}</p>
        <p className="font-body text-[11px] text-ink-muted">{content.blurb}</p>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-body text-[11px]">
        <span className="text-ink-faint">typeId</span>
        <span className="truncate font-mono text-ink">{content.typeId}</span>
        {content.transport !== "" && (
          <>
            <span className="text-ink-faint">{catalogTopologyCopy(useLocale().locale).transport}</span>
            <span className="text-ink">{content.transport}</span>
          </>
        )}
        {content.configSchema !== "" && (
          <>
            <span className="text-ink-faint">Schema</span>
            <span className="truncate font-mono text-ink">{content.configSchema}</span>
          </>
        )}
        <span className="text-ink-faint">{catalogTopologyCopy(useLocale().locale).wireCommands}</span>
        <span className="font-mono text-ink">{commandCount}</span>
      </div>
      {settings && (
        <DriverSection title={catalogTopologyCopy(useLocale().locale).transport === "Transport" ? "Interface" : "Interfaccia"}>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {Object.entries(settings)
              .filter(([key, value]) => key !== "kind" && String(value).trim() !== "")
              .map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <span className="font-body text-[9px] uppercase tracking-wide text-ink-faint">{key}</span>
                  <div className="truncate font-mono text-[10px] text-ink">{String(value)}</div>
                </div>
              ))}
          </div>
        </DriverSection>
      )}
      {content.config.length > 0 && (
        <DriverSection title="Config">
          {content.config.map((field) => (
            <SchemaFieldRow key={field.fieldId} field={field} />
          ))}
        </DriverSection>
      )}
      {content.records.length > 0 && (
        <DriverSection title="Record">
          {content.records.map((field) => (
            <SchemaFieldRow key={field.fieldId} field={field} />
          ))}
        </DriverSection>
      )}
      {content.commands.length > 0 && (
        <DriverSection title={catalogTopologyCopy(useLocale().locale).wireCommands}>
          {content.commands.map((command) => (
            <div key={command.commandId}>
              <p className="font-mono text-[11px] text-ink">
                {command.commandId} · {command.name}
              </p>
              {command.fields.map((field) => (
                <SchemaFieldRow key={field.fieldId} field={field} />
              ))}
            </div>
          ))}
        </DriverSection>
      )}
      {content.protocol && content.protocol.fields.length > 0 && (
        <DriverSection title={catalogTopologyCopy(useLocale().locale).quantities}>
          {content.protocol.fields.map((field) => (
            <div key={field.id} className="rounded-slsm bg-surface px-2 py-1.5">
              <p className="font-body text-[11px] font-semibold text-ink">{field.label || field.name}</p>
              <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                {compositionLines(field).map((line) => (
                  <div key={line.label} className="min-w-0">
                    <span className="font-body text-[9px] uppercase tracking-wide text-ink-faint">{localizeCompositionLabel(line.label, useLocale().locale)}</span>
                    <div className="truncate font-mono text-[10px] text-ink">{line.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </DriverSection>
      )}
      {profiles.length > 0 && (
        <DriverSection title={catalogTopologyCopy(useLocale().locale).profilesOnCore}>
          {profiles.map((profile) => (
            <p key={`${profile.profileId}@${profile.version}`} className="font-mono text-[11px] text-ink">
              {profile.profileId}@{profile.version}
            </p>
          ))}
        </DriverSection>
      )}
    </div>
  );
}

function DriverSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 font-body text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function SchemaFieldRow({ field }: { readonly field: DriverSchemaField }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[11px] text-ink">
        {field.fieldId} · {field.name}
        {field.unit ? ` · ${field.unit}` : ""}
      </p>
      <p className="font-body text-[10px] text-ink-faint">
        {field.type}
        {field.description !== "" ? ` — ${field.description}` : ""}
      </p>
    </div>
  );
}
