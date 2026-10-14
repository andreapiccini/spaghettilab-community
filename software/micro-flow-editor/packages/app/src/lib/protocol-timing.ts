/**
 * Shared protocol frame model: datasheet strip ↔ timing chart use the same segments.
 */

import type { DeviceRecipeDraft, DeviceRecipeOp, DeviceRecipePhase } from "./device-recipe-draft.js";
import type { TimingEdge, TimingLane, TimingLevel, TimingPhaseBand } from "./timing-scope-types.js";

export type ProtocolCellKind =
  | "start"
  | "restart"
  | "stop"
  | "addr_w"
  | "addr_r"
  | "ack"
  | "nack"
  | "data"
  | "reg"
  | "cs"
  | "byte"
  | "idle";

export type ProtocolCell = {
  readonly id: string;
  readonly opId: string;
  readonly kind: ProtocolCellKind;
  readonly label: string;
  /** Relative width in datasheet units (bit-ish). */
  readonly units: number;
  readonly t0: number;
  readonly t1: number;
};

export type ProtocolTimingModel = {
  readonly cells: readonly ProtocolCell[];
  readonly phaseBands: readonly TimingPhaseBand[];
  readonly lanes: readonly TimingLane[];
  readonly durationMs: number;
  readonly busOps: readonly DeviceRecipeOp[];
  readonly postOps: readonly DeviceRecipeOp[];
};

const BIT = 1; // time unit per bit (illustrative)

function addr7(address?: string): string {
  const raw = (address ?? "0x00").trim();
  return raw.toLowerCase().startsWith("0x") ? raw : `0x${raw}`;
}

export type ProtocolTimingOptions = {
  /** Measured or captured RX bytes per op (null = slot known, value unknown). */
  readonly rxByOpId?: Readonly<Record<string, readonly (number | null)[]>>;
  /** Highlight RX data cells in phase bands (green tint). */
  readonly emphasizeRx?: boolean;
};

function rxLabel(index: number, value: number | null | undefined, fallbackPattern: number): { label: string; bits: number } {
  if (value === null) return { label: `RX${index}`, bits: 0 };
  if (value === undefined) return { label: `D${index}`, bits: fallbackPattern & 0xff };
  return { label: `0x${(value & 0xff).toString(16).padStart(2, "0")}`, bits: value & 0xff };
}

/** Expand one I2C op into datasheet cells + accumulate time cursor. */
function expandI2cOp(
  op: DeviceRecipeOp,
  address: string,
  t0: number,
  rxBytes?: readonly (number | null)[],
): { cells: ProtocolCell[]; t1: number; scl: TimingEdge[]; sda: TimingEdge[]; rxCellIds: string[] } {
  const cells: ProtocolCell[] = [];
  const scl: TimingEdge[] = [];
  const sda: TimingEdge[] = [];
  const rxCellIds: string[] = [];
  let t = t0;

  const pushCell = (kind: ProtocolCellKind, label: string, units: number, bits?: TimingLevel[], isRx = false) => {
    const start = t;
    const end = t + units * BIT;
    const id = `${op.id}-${kind}-${cells.length}`;
    cells.push({ id, opId: op.id, kind, label, units, t0: start, t1: end });
    if (isRx) rxCellIds.push(id);
    if (bits) {
      for (let i = 0; i < bits.length; i++) {
        const bt = start + i * BIT;
        scl.push({ t: bt, level: 0 }, { t: bt + BIT * 0.45, level: 1 }, { t: bt + BIT * 0.9, level: 0 });
        sda.push({ t: bt, level: bits[i]! });
      }
    } else if (kind === "start" || kind === "restart") {
      sda.push({ t: start, level: 1 }, { t: start + units * BIT * 0.4, level: 0 });
      scl.push({ t: start, level: 1 });
    } else if (kind === "stop") {
      sda.push({ t: start, level: 0 }, { t: start + units * BIT * 0.5, level: 1 });
      scl.push({ t: start, level: 1 });
    } else if (kind === "ack" || kind === "nack") {
      scl.push({ t: start, level: 0 }, { t: start + BIT * 0.45, level: 1 }, { t: start + BIT * 0.9, level: 0 });
      sda.push({ t: start, level: kind === "ack" ? 0 : 1 });
    }
    t = end;
  };

  const byteBits = (n: number): TimingLevel[] =>
    Array.from({ length: 8 }, (_, i) => (((n >> (7 - i)) & 1) === 1 ? 1 : 0));

  const addrNum = Number.parseInt(address.replace(/^0x/i, ""), 16) || 0;

  if (op.type === "i2c_write") {
    pushCell("start", "S", 2);
    pushCell("addr_w", `${address}+W`, 8, byteBits((addrNum << 1) & 0xfe));
    pushCell("ack", "A", 1);
    if (op.reg) {
      const regN = Number.parseInt(op.reg.replace(/^0x/i, ""), 16) || 0;
      pushCell("reg", op.reg, 8, byteBits(regN));
      pushCell("ack", "A", 1);
    }
    for (const b of op.bytes) {
      const n = Number.parseInt(b.replace(/^0x/i, ""), 16) || 0;
      pushCell("data", b, 8, byteBits(n));
      pushCell("ack", "A", 1);
    }
    pushCell("stop", "P", 2);
  } else if (op.type === "i2c_read") {
    pushCell("start", "S", 2);
    pushCell("addr_r", `${address}+R`, 8, byteBits((addrNum << 1) | 1));
    pushCell("ack", "A", 1);
    for (let i = 0; i < op.len; i++) {
      const { label, bits } = rxLabel(i, rxBytes?.[i], 0xa0 + i);
      pushCell("data", label, 8, byteBits(bits), true);
      pushCell(i === op.len - 1 ? "nack" : "ack", i === op.len - 1 ? "N" : "A", 1);
    }
    pushCell("stop", "P", 2);
  } else if (op.type === "i2c_write_read") {
    pushCell("start", "S", 2);
    pushCell("addr_w", `${address}+W`, 8, byteBits((addrNum << 1) & 0xfe));
    pushCell("ack", "A", 1);
    if (op.reg) {
      const regN = Number.parseInt(op.reg.replace(/^0x/i, ""), 16) || 0;
      pushCell("reg", op.reg, 8, byteBits(regN));
      pushCell("ack", "A", 1);
    }
    for (const b of op.writeBytes) {
      const n = Number.parseInt(b.replace(/^0x/i, ""), 16) || 0;
      pushCell("data", b, 8, byteBits(n));
      pushCell("ack", "A", 1);
    }
    if (op.repeatedStart) {
      pushCell("restart", "Sr", 2);
    } else {
      pushCell("stop", "P", 2);
      pushCell("start", "S", 2);
    }
    pushCell("addr_r", `${address}+R`, 8, byteBits((addrNum << 1) | 1));
    pushCell("ack", "A", 1);
    for (let i = 0; i < op.readLen; i++) {
      const { label, bits } = rxLabel(i, rxBytes?.[i], 0xc0 + i);
      pushCell("data", label, 8, byteBits(bits), true);
      pushCell(i === op.readLen - 1 ? "nack" : "ack", i === op.readLen - 1 ? "N" : "A", 1);
    }
    pushCell("stop", "P", 2);
  } else {
    return { cells: [], t1: t0, scl: [], sda: [], rxCellIds: [] };
  }

  return { cells, t1: t, scl, sda, rxCellIds };
}

export function isBusOp(op: DeviceRecipeOp): boolean {
  return (
    op.type === "i2c_write" ||
    op.type === "i2c_read" ||
    op.type === "i2c_write_read" ||
    op.type === "spi_cs" ||
    op.type === "spi_transfer" ||
    op.type === "gpio_read" ||
    op.type === "gpio_write" ||
    op.type === "gpio_debounce" ||
    op.type === "adc_sample" ||
    op.type === "adc_multi_sample" ||
    op.type === "w1_reset" ||
    op.type === "w1_match_rom" ||
    op.type === "w1_write" ||
    op.type === "w1_read" ||
    op.type === "w1_wait_convert" ||
    op.type === "w1_crc"
  );
}

export function isPostOp(op: DeviceRecipeOp): boolean {
  return (
    op.type === "decode" ||
    op.type === "encode" ||
    op.type === "emit" ||
    op.type === "average" ||
    op.type === "filter" ||
    op.type === "map_range" ||
    op.type === "wait" ||
    op.type === "sample_external"
  );
}

export function buildProtocolTiming(
  draft: DeviceRecipeDraft,
  phase: DeviceRecipePhase,
  options?: ProtocolTimingOptions,
): ProtocolTimingModel {
  return buildProtocolTimingFromOps(draft, draft.phases[phase], options);
}

/** Timing model from an arbitrary op list (e.g. Testa plan = Init + Task). */
export function buildProtocolTimingFromOps(
  draft: DeviceRecipeDraft,
  ops: readonly DeviceRecipeOp[],
  options?: ProtocolTimingOptions,
): ProtocolTimingModel {
  const busOps = ops.filter(isBusOp);
  const postOps = ops.filter(isPostOp);
  const bus = draft.binding.bus;
  const rxByOpId = options?.rxByOpId;
  const emphasizeRx = options?.emphasizeRx ?? Boolean(rxByOpId);

  if (bus === "i2c") {
    const address = addr7(draft.binding.i2c?.address);
    const cells: ProtocolCell[] = [];
    const sclEdges: TimingEdge[] = [{ t: 0, level: 1 }];
    const sdaEdges: TimingEdge[] = [{ t: 0, level: 1 }];
    const rxCellIdSet = new Set<string>();
    let t = 2;
    for (const op of busOps) {
      if (op.type !== "i2c_write" && op.type !== "i2c_read" && op.type !== "i2c_write_read") continue;
      const part = expandI2cOp(op, address, t, rxByOpId?.[op.id]);
      cells.push(...part.cells);
      for (const id of part.rxCellIds) rxCellIdSet.add(id);
      sclEdges.push(...part.scl);
      sdaEdges.push(...part.sda);
      t = part.t1 + 2;
    }
    const durationMs = Math.max(t + 2, 20);
    sclEdges.push({ t: durationMs, level: 1 });
    sdaEdges.push({ t: durationMs, level: 1 });

    const sampleTimes = cells
      .filter((c) => c.kind === "addr_w" || c.kind === "addr_r" || c.kind === "data" || c.kind === "reg")
      .flatMap((c) => {
        const times: number[] = [];
        for (let i = 0; i < 8; i++) times.push(c.t0 + i * BIT + BIT * 0.45);
        return times;
      });

    const lanes: TimingLane[] = [
      { id: "scl", label: "SCL", edges: mergeEdges(sclEdges), sampleTimes },
      {
        id: "sda",
        label: "SDA",
        edges: mergeEdges(sdaEdges),
        sampleTimes: sampleTimes.map((x) => x + 0.05),
      },
    ];

    const bands = phaseBandsFromCells(cells).map((band) => {
      if (!emphasizeRx) return band;
      const cell = cells.find((c) => c.id === band.id);
      if (cell && rxCellIdSet.has(cell.id)) {
        return { ...band, color: "rgba(16, 185, 129, 0.28)", label: cell.label };
      }
      return band;
    });

    return { cells, phaseBands: bands, lanes, durationMs, busOps, postOps };
  }

  if (bus === "spi" && draft.binding.spi) {
    const cells: ProtocolCell[] = [];
    const cs: TimingEdge[] = [{ t: 0, level: 1 }];
    const sck: TimingEdge[] = [{ t: 0, level: draft.binding.spi.mode % 2 === 0 ? 0 : 1 }];
    const mosi: TimingEdge[] = [{ t: 0, level: 0 }];
    let t = 2;
    let csLow = false;
    for (const op of busOps) {
      if (op.type === "spi_cs") {
        const start = t;
        t += 2;
        cells.push({
          id: `${op.id}-cs`,
          opId: op.id,
          kind: "cs",
          label: op.assert ? "CS↓" : "CS↑",
          units: 2,
          t0: start,
          t1: t,
        });
        cs.push({ t: start, level: op.assert ? 0 : 1 });
        csLow = op.assert;
      } else if (op.type === "spi_transfer") {
        const n = Math.max(op.txBytes.length, op.rxLen, 1);
        if (!csLow) {
          cs.push({ t, level: 0 });
          cells.push({ id: `${op.id}-csauto`, opId: op.id, kind: "cs", label: "CS↓", units: 1, t0: t, t1: t + 1 });
          t += 1;
          csLow = true;
        }
        for (let i = 0; i < n; i++) {
          const label = op.txBytes[i] ?? `RX${i}`;
          const start = t;
          const end = t + 8 * BIT;
          cells.push({ id: `${op.id}-b${i}`, opId: op.id, kind: "byte", label, units: 8, t0: start, t1: end });
          for (let b = 0; b < 8; b++) {
            const bt = start + b * BIT;
            sck.push({ t: bt, level: 0 }, { t: bt + BIT * 0.45, level: 1 }, { t: bt + BIT * 0.9, level: 0 });
            const bit = Number.parseInt((op.txBytes[i] ?? "0").replace(/^0x/i, ""), 16);
            mosi.push({ t: bt, level: ((bit >> (7 - b)) & 1) === 1 ? 1 : 0 });
          }
          t = end;
        }
        if (!op.keepCs) {
          cs.push({ t, level: 1 });
          cells.push({ id: `${op.id}-csup`, opId: op.id, kind: "cs", label: "CS↑", units: 1, t0: t, t1: t + 1 });
          t += 1;
          csLow = false;
        }
      }
    }
    if (csLow) {
      cs.push({ t, level: 1 });
      t += 2;
    }
    const durationMs = t + 2;
    const lanes: TimingLane[] = [
      { id: "cs", label: "CS", edges: mergeEdges(cs) },
      {
        id: "sck",
        label: "SCK",
        edges: mergeEdges(sck),
        sampleTimes: cells.filter((c) => c.kind === "byte").flatMap((c) => Array.from({ length: 8 }, (_, i) => c.t0 + i * BIT + BIT * 0.45)),
      },
      { id: "mosi", label: "MOSI", edges: mergeEdges(mosi) },
    ];
    return { cells, phaseBands: phaseBandsFromCells(cells), lanes, durationMs, busOps, postOps };
  }

  // GPIO / others: empty protocol cells; timing handled elsewhere
  return { cells: [], phaseBands: [], lanes: [], durationMs: 1, busOps, postOps };
}

/** Dark translucent fills for the timing chart bands (independent of datasheet strip greys). */
function timingBandFill(kind: ProtocolCellKind): string {
  switch (kind) {
    case "start":
    case "restart":
    case "stop":
      return "#1e3a5f33";
    case "addr_w":
    case "addr_r":
      return "#2563eb33";
    case "data":
    case "byte":
      return "#33415533";
    case "reg":
      return "#47556933";
    case "cs":
      return "#1d4ed833";
    default:
      return "#64748b33";
  }
}

export function phaseBandsFromCells(cells: readonly ProtocolCell[]): TimingPhaseBand[] {
  // Skip tiny ACK/NACK labels on the chart (still in datasheet strip) to keep the scope readable.
  return cells
    .filter((c) => c.kind !== "ack" && c.kind !== "nack")
    .map((c) => ({
      id: c.id,
      t0: c.t0,
      t1: c.t1,
      label: c.label,
      opId: c.opId,
      color: timingBandFill(c.kind),
    }));
}

function mergeEdges(edges: TimingEdge[]): TimingEdge[] {
  const sorted = [...edges].sort((a, b) => a.t - b.t);
  const out: TimingEdge[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && last.t === e.t) out[out.length - 1] = e;
    else if (!last || last.level !== e.level || last.t !== e.t) out.push(e);
  }
  return out;
}

/**
 * Datasheet strip fills: pastel framing cells; light grey for ADDR/DATA bytes.
 * Start / restart / stop each get a distinct pastel.
 */
export function cellFill(kind: ProtocolCellKind): string {
  switch (kind) {
    case "start":
      return "#c9daf8"; // soft blue
    case "restart":
      return "#d4c4f7"; // soft violet
    case "stop":
      return "#f5d0c5"; // soft peach
    case "ack":
      return "#c5e8d4"; // soft mint
    case "nack":
      return "#fde68a"; // soft amber
    case "cs":
      return "#ddd6fe"; // soft lilac
    case "idle":
      return "#e8e8e8";
    case "addr_w":
    case "addr_r":
    case "data":
    case "byte":
    case "reg":
      return "#e8e8e8"; // light grey
    default:
      return "#f0f0f0";
  }
}

export function cellInk(kind: ProtocolCellKind): string {
  switch (kind) {
    case "start":
      return "#1e3a5f";
    case "restart":
      return "#4c1d95";
    case "stop":
      return "#7c2d12";
    case "ack":
      return "#14532d";
    case "nack":
      return "#78350f";
    case "cs":
      return "#4c1d95";
    default:
      return "#374151";
  }
}
