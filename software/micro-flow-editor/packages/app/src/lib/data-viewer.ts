/** Values stay typed until presentation; in particular uint64 never passes through Number. */
export type ViewerValue = bigint | number | string | boolean | Uint8Array;
export function formatViewerValue(
  value: ViewerValue,
  decimals = 2,
  kind?: "digital" | "boolean" | "number" | "text",
): { text: string; type: string } {
  if (
    (kind === "digital" || kind === "boolean") &&
    (typeof value === "boolean" ||
      value === 0 ||
      value === 1 ||
      value === 0n ||
      value === 1n)
  ) {
    const high = value === true || value === 1 || value === 1n;
    return kind === "digital"
      ? { text: high ? "1 · HIGH" : "0 · LOW", type: "Digitale" }
      : { text: high ? "true" : "false", type: "Booleano" };
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

/** Match the deployed driver identity; its sample schema need not be profileId + .s. */
export function viewerModuleMatches(
  module: { key: number; properties: Readonly<Record<string, unknown>> },
  source: { key: number; schemaId?: string; profileId?: string },
): boolean {
  return (
    module.key === source.key &&
    (!source.schemaId ||
      (source.profileId
        ? module.properties[1] === source.profileId
        : `${module.properties[1]}.s` === source.schemaId))
  );
}

/** Semantic type comes from the connected output, never from text/numeric guessing. */
export type ViewerColorKind = "hex" | "rgb" | "red" | "green" | "blue";
export function generatorColorKind(
  type: string,
  handle: string,
): ViewerColorKind | undefined {
  if (type !== "led_driver" && type !== "color_split") return undefined;
  return ({ "0": "hex", "1": "red", "2": "green", "3": "blue" } as const)[
    handle as "0"
  ];
}
export function viewerColor(
  value: ViewerValue,
  kind?: ViewerColorKind,
): { color: string; text: string; type: string } | undefined {
  if (!kind) return undefined;
  if (kind === "hex")
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
      ? { color: value.toUpperCase(), text: value.toUpperCase(), type: "Colore" }
      : undefined;
  if (typeof value !== "number" && typeof value !== "bigint") return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  if (kind === "rgb") {
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0xffffff)
      return undefined;
    const color = "#" + numeric.toString(16).padStart(6, "0").toUpperCase();
    return { color, text: color, type: "Colore RGB" };
  }
  if (numeric < 0 || numeric > 100) return undefined;
  const byte = Math.round((numeric * 255) / 100)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return {
    color:
      "#" +
      (kind === "red"
        ? byte + "0000"
        : kind === "green"
          ? "00" + byte + "00"
          : "0000" + byte),
    text: numeric.toLocaleString("it-IT", { maximumFractionDigits: 2 }) + "%",
    type: { red: "Rosso", green: "Verde", blue: "Blu" }[kind],
  };
}
