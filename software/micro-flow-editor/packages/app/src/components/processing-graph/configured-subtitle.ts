import { formatThresholdRuleExpr } from "./threshold-rule-fields.js";

/**
 * Live canvas subtitle from a Block/Rule's configured `properties`.
 * Catalog labels stay on the node title; this line is what the block *does*
 * (e.g. IF Condition reads `temp ≥ 30` instead of "Soglia booleana").
 *
 * Field meaning comes from firmware schemas — GET_CATALOG still has none.
 * Block `threshold` (`spaghetti_blocks/blocks_logic.c`): field 1 = `level`,
 * `out = in >= level`. Rule `threshold` (`threshold.h`): fields 3/4 = LOWER/UPPER,
 * 8 = GPIO level when the condition is true.
 */

export function formatConfiguredSubtitle(
  kind: "block" | "rule",
  typeId: string,
  properties: Readonly<Record<string, unknown>>,
  inputLabel?: string,
  locale: "it" | "en" = "it",
): string | undefined {
  const expr = kind === "rule" ? formatRule(typeId, properties, locale) : formatBlock(typeId, properties, locale);
  if (expr === undefined) return formatGenericProperties(properties);
  if (inputLabel && inputLabel.trim() !== "") return `${inputLabel.trim()} ${expr}`;
  return expr;
}

function formatBlock(
  typeId: string,
  properties: Readonly<Record<string, unknown>>,
  locale: "it" | "en" = "it",
): string | undefined {
  switch (typeId) {
    case "threshold": {
      const level = propText(properties["1"]);
      return level === undefined ? undefined : `≥ ${level}`;
    }
    case "hysteresis": {
      const low = propText(properties["1"]);
      const high = propText(properties["2"]);
      return low !== undefined && high !== undefined ? `${low} … ${high}` : undefined;
    }
    case "debounce": {
      const samples = propText(properties["1"]);
      return samples === undefined ? undefined : `${samples} ${locale === "en" ? "samples" : "campioni"}`;
    }
    case "scale_offset": {
      const scale = propText(properties["1"]);
      const offset = propText(properties["2"]);
      if (scale === undefined || offset === undefined) return undefined;
      const offsetN = Number(offset);
      const sign = !Number.isNaN(offsetN) && offsetN < 0 ? "−" : "+";
      const abs = !Number.isNaN(offsetN) ? String(Math.abs(offsetN)) : offset;
      return `× ${scale} ${sign} ${abs}`;
    }
    case "clamp": {
      const min = propText(properties["3"]);
      const max = propText(properties["4"]);
      return min !== undefined && max !== undefined ? `[${min}, ${max}]` : undefined;
    }
    case "map_range": {
      const inMin = propText(properties["5"]);
      const inMax = propText(properties["6"]);
      const outMin = propText(properties["7"]);
      const outMax = propText(properties["8"]);
      if (inMin === undefined || inMax === undefined || outMin === undefined || outMax === undefined) return undefined;
      return `${inMin}…${inMax} → ${outMin}…${outMax}`;
    }
    default:
      return undefined;
  }
}

function formatRule(
  typeId: string,
  properties: Readonly<Record<string, unknown>>,
  locale: "it" | "en" = "it",
): string | undefined {
  if (typeId !== "threshold") return undefined;
  return formatThresholdRuleExpr(properties, locale);
}

function formatGenericProperties(properties: Readonly<Record<string, unknown>>): string | undefined {
  const parts = Object.keys(properties)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .map((key) => {
      const text = propText(properties[key]);
      return text === undefined ? undefined : text;
    })
    .filter((part): part is string => part !== undefined);
  if (parts.length === 0) return undefined;
  return parts.join(" · ");
}

function propText(value: unknown): string | undefined {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    const asBigintLiteral = /^(-?\d+)n$/.exec(trimmed);
    if (asBigintLiteral) return asBigintLiteral[1];
    return trimmed;
  }
  return undefined;
}
