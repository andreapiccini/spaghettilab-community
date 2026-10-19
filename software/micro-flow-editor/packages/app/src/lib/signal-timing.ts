/** Persist both durations in milliseconds: percentages are only a legacy fallback. */
export function signalDurations(properties: Readonly<Record<string, unknown>>) {
  const period = Number(properties.periodMs ?? 500);
  const duty = Number(properties.dutyCycle ?? 50);
  const onMs = Number(properties.onDurationMs ?? Math.round(period * duty / 100));
  const offMs = Number(properties.offDurationMs ?? (period - onMs));
  return { onMs, offMs, periodMs: onMs + offMs };
}
export function withSignalDurations(properties: Record<string, unknown>, onMs: number, offMs: number) {
  onMs = Math.round(onMs); offMs = Math.round(offMs);
  return { ...properties, onDurationMs: onMs, offDurationMs: offMs,
    periodMs: onMs + offMs, dutyCycle: onMs / (onMs + offMs) * 100 };
}
