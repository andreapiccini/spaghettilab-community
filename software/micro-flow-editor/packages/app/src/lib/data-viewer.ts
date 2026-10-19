/** Values stay typed until presentation; in particular uint64 never passes through Number. */
export type ViewerValue = bigint | number | string | boolean | Uint8Array;
export function formatViewerValue(
  value: ViewerValue,
  decimals = 2,
  kind?: "digital" | "boolean" | "number" | "text",
): { text: string; type: string } {
  if ((kind === "digital" || kind === "boolean") &&
      (typeof value === "boolean" || value === 0 || value === 1 || value === 0n || value === 1n)) {
    const high = value === true || value === 1 || value === 1n;
    return kind === "digital" ? { text: high ? "1 · HIGH" : "0 · LOW", type: "Digitale" } : { text: high ? "true" : "false", type: "Booleano" };
  }
  if (typeof value === "string") return { text: value, type: "Testo" };
  if (typeof value === "boolean")
    return { text: value ? "true" : "false", type: "Booleano" };
  if (typeof value === "bigint") return { text: value.toString(), type: "Intero" };
  if (typeof value === "number")
    return {
      text: Number.isFinite(value)
        ? value.toLocaleString("it-IT", {
            maximumFractionDigits: Math.max(
              0,
              Math.min(6, Math.trunc(Number.isFinite(decimals) ? decimals : 2)),
            ),
            useGrouping: false,
          })
        : "—",
      type: "Decimale",
    };
  return {
    text: Array.from(value, (byte) =>
      byte.toString(16).padStart(2, "0").toUpperCase(),
    ).join(" "),
    type: "Byte · HEX",
  };
}
