/** Values stay typed until presentation; in particular uint64 never passes through Number. */
export type ViewerValue = bigint | number | string | boolean | Uint8Array;
export function formatViewerValue(
  value: ViewerValue,
  decimals = 2,
): { text: string; type: string } {
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
