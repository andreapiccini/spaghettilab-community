/** Canonical config properties contain bigint values; plain JSON.stringify throws. */
export function formatConfigDiffValue(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? `${item}n` : item,
  ) ?? "—";
}

export function changedConfigFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => formatConfigDiffValue(before[key]) !== formatConfigDiffValue(after[key]),
  );
}
