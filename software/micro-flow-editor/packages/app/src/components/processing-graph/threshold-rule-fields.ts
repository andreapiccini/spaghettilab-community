/**
 * Rule `threshold` authoring ↔ firmware fields
 * (`spaghetti_rules/threshold/threshold.h`):
 * 3 = LOWER, 4 = UPPER, 7 = command BOOL field, 8 = above_value.
 * GPIO `digital_line_set` only accepts set(high|low) — not "become input".
 */

export type ThresholdOp = "gte" | "gt" | "lte" | "lt" | "eq";
export type GpioLevel = "high" | "low";

export const THRESHOLD_OP_OPTIONS = [
  { value: "gte", label: "≥  maggiore o uguale" },
  { value: "gt", label: ">  maggiore" },
  { value: "lte", label: "≤  minore o uguale" },
  { value: "lt", label: "<  minore" },
  { value: "eq", label: "=  uguale" },
] as const;

export const GPIO_LEVEL_OPTIONS = [
  { value: "high", label: "Va alto" },
  { value: "low", label: "Va basso" },
] as const;

const LOWER = "3";
const UPPER = "4";
const COMMAND_FIELD = "7";
const ABOVE = "8";
const SET_HIGH_FIELD = 1n;

export function withThresholdFirmwareFields(
  properties: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const parsed = readThresholdRule(properties);
  const encoded = encodeThresholdBounds(parsed.op, parsed.level, parsed.action);
  const keepBand = properties.op === undefined && hasDistinctBand(properties);
  return {
    ...properties,
    op: parsed.op,
    level: parsed.level,
    action: parsed.action,
    [LOWER]: keepBand ? intOr(properties[LOWER], encoded.lower) : encoded.lower,
    [UPPER]: keepBand ? intOr(properties[UPPER], encoded.upper) : encoded.upper,
    [COMMAND_FIELD]: SET_HIGH_FIELD,
    [ABOVE]: keepBand ? boolOr(properties[ABOVE], encoded.above) : encoded.above,
  };
}

export function readThresholdRule(properties: Readonly<Record<string, unknown>>): {
  readonly op: ThresholdOp;
  readonly level: bigint;
  readonly action: GpioLevel;
} {
  const storedOp = asOp(properties.op);
  const storedAction = asLevel(properties.action);
  const level = asInt(properties.level) ?? asInt(properties[UPPER]) ?? asInt(properties[LOWER]) ?? 0n;
  if (storedOp && storedAction) {
    return { op: storedOp, level: asInt(properties.level) ?? inferLevel(storedOp, properties) ?? level, action: storedAction };
  }

  const lower = asInt(properties[LOWER]);
  const upper = asInt(properties[UPPER]);
  const above = boolOr(properties[ABOVE], true);
  if (storedOp) {
    return { op: storedOp, level, action: storedAction ?? (above ? "high" : "low") };
  }
  if (lower !== undefined && upper !== undefined && lower === upper) {
    return { op: "gt", level: lower, action: above ? "high" : "low" };
  }
  if (lower !== undefined && upper !== undefined && lower === upper - 1n) {
    return { op: "gte", level: upper, action: above ? "high" : "low" };
  }
  return { op: storedOp ?? "gte", level: upper ?? level, action: storedAction ?? (above ? "high" : "low") };
}

export function formatThresholdRuleExpr(
  properties: Readonly<Record<string, unknown>>,
  locale: "it" | "en" = "it",
): string | undefined {
  const lower = asInt(properties[LOWER]);
  const upper = asInt(properties[UPPER]);
  if (
    properties.op === undefined &&
    properties.level === undefined &&
    lower === undefined &&
    upper === undefined
  ) {
    return undefined;
  }
  if (properties.op === undefined && lower !== undefined && upper !== undefined && lower < upper && lower !== upper - 1n) {
    return `${lower.toString()} … ${upper.toString()}`;
  }
  const parsed = readThresholdRule(properties);
  const symbol = parsed.op === "gte" ? "≥" : parsed.op === "gt" ? ">" : parsed.op === "lte" ? "≤" : parsed.op === "lt" ? "<" : "=";
  const levelLabel = parsed.action === "high" ? (locale === "en" ? "high" : "alto") : locale === "en" ? "low" : "basso";
  return `${symbol} ${parsed.level.toString()} → ${levelLabel}`;
}

function encodeThresholdBounds(op: ThresholdOp, level: bigint, action: GpioLevel): {
  readonly lower: bigint;
  readonly upper: bigint;
  readonly above: boolean;
} {
  const high = action === "high";
  switch (op) {
    case "gt":
      return { lower: level, upper: level, above: high };
    case "lt":
      return { lower: level, upper: level, above: !high };
    case "lte":
      return { lower: level + 1n, upper: level + 1n, above: !high };
    case "eq":
    case "gte":
    default:
      return { lower: level - 1n, upper: level - 1n, above: high };
  }
}

function inferLevel(op: ThresholdOp, properties: Readonly<Record<string, unknown>>): bigint | undefined {
  const lower = asInt(properties[LOWER]);
  const upper = asInt(properties[UPPER]);
  if (op === "gte" || op === "eq") return upper !== undefined ? upper + 1n : lower !== undefined ? lower + 1n : undefined;
  if (op === "lte") return upper !== undefined ? upper - 1n : lower !== undefined ? lower - 1n : undefined;
  return upper ?? lower;
}

function hasDistinctBand(properties: Readonly<Record<string, unknown>>): boolean {
  const lower = asInt(properties[LOWER]);
  const upper = asInt(properties[UPPER]);
  return lower !== undefined && upper !== undefined && lower < upper && lower !== upper - 1n;
}

function asOp(value: unknown): ThresholdOp | undefined {
  return value === "gte" || value === "gt" || value === "lte" || value === "lt" || value === "eq" ? value : undefined;
}

function asLevel(value: unknown): GpioLevel | undefined {
  return value === "high" || value === "low" ? value : undefined;
}

function asInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "-") return undefined;
    const literal = /^(-?\d+)n?$/.exec(trimmed);
    if (literal) return BigInt(literal[1]!);
  }
  return undefined;
}

function intOr(value: unknown, fallback: bigint): bigint {
  return asInt(value) ?? fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "high") return true;
  if (value === "low") return false;
  return fallback;
}
