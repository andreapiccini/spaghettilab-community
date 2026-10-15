import type { TimingPhaseBand, TimingStepSpan } from "./timing-scope-types.js";
/** Schematic spacing keeps bytes/framing readable without a huge real-time wait gap. */
export function readableTimingScale(
  duration: number,
  bands: readonly TimingPhaseBand[],
  steps: readonly TimingStepSpan[],
  zoom = 1,
) {
  const points = [
    ...new Set([
      0,
      duration,
      ...bands.flatMap((band) => [band.t0, band.t1]),
      ...steps.flatMap((step) => [step.t0, step.t1]),
    ]),
  ].sort((a, b) => a - b);
  const chunks = points.slice(1).map((end, i) => {
    const start = points[i]!,
      band = bands.find((band) => band.t0 <= start && band.t1 >= end);
    const label = band?.label ?? "";
    const minimum = /^0x|^D\d|^\$/.test(label)
      ? 72
      : ["S", "P", "Sr"].includes(label)
        ? 40
        : 30;
    const width = band
      ? (Math.max(minimum, minimum * 1.35 * zoom) * (end - start)) /
        Math.max(0.00001, band.t1 - band.t0)
      : Math.max(
          24,
          Math.min(160, (520 * zoom * (end - start)) / Math.max(1, duration)),
        );
    return { start, end, width };
  });
  const rawWidth = chunks.reduce((sum, chunk) => sum + chunk.width, 0);
  const factor = Math.max(1, 520 / Math.max(1, rawWidth));
  const xAt = (time: number) => {
    let x = 0;
    for (const chunk of chunks) {
      if (time >= chunk.end) x += chunk.width;
      else if (time > chunk.start) {
        x += (chunk.width * (time - chunk.start)) / (chunk.end - chunk.start);
        break;
      } else break;
    }
    return x * factor;
  };
  return { width: rawWidth * factor, xAt };
}
