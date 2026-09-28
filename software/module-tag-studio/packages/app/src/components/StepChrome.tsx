export type StepHelpContent = {
  title: string;
  body: string;
  bullets?: string[];
  tip?: string;
};

export function StepHelp({ content, defaultOpen = true }: { content: StepHelpContent; defaultOpen?: boolean }) {
  return (
    <details className="help-panel" open={defaultOpen}>
      <summary>Help — {content.title}</summary>
      <div className="help-body">
        <p style={{ margin: 0 }}>{content.body}</p>
        {content.bullets && content.bullets.length > 0 && (
          <ul>
            {content.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        {content.tip && <div className="help-tip">{content.tip}</div>}
      </div>
    </details>
  );
}

export type NfcStageMode = "idle" | "scanning" | "busy" | "ok" | "err";

export function NfcStage({
  mode,
  caption,
  label = "NFC",
}: {
  mode: NfcStageMode;
  caption: string;
  label?: string;
}) {
  const cls = ["nfc-stage", mode === "scanning" ? "scanning" : "", mode === "busy" ? "busy" : "", mode === "ok" ? "ok" : "", mode === "err" ? "err" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} aria-live="polite">
      <span className="nfc-ring" />
      <span className="nfc-ring r2" />
      <span className="nfc-ring r3" />
      <div className="nfc-chip">{label}</div>
      <div className="nfc-caption">{caption}</div>
    </div>
  );
}

export function WriteProgress({
  phase,
  index,
  total,
  page,
}: {
  phase: string;
  index?: number;
  total?: number;
  page?: number;
}) {
  const pct = total && total > 0 && index != null ? Math.min(100, Math.round(((index + 1) / total) * 100)) : phase === "done" ? 100 : phase === "verify" ? 92 : 8;
  return (
    <div className="progress-wrap">
      <div className="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-meta">
        <span>{phase}{page != null ? ` · page ${page}` : ""}</span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}
