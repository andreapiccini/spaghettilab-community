import { expect, it } from "vitest";
import { signalDurations, withSignalDurations } from "../signal-timing.js";
it("keeps 1 and 2 seconds exact through repeated edits", () => {
  let props: Record<string, unknown> = {};
  for (let i = 0; i < 20; i++) props = withSignalDurations(props, 1000, 2000);
  expect(signalDurations(props)).toEqual({ onMs: 1000, offMs: 2000, periodMs: 3000 });
});
it("preserves millisecond precision including asymmetric pulses", () => {
  const props = withSignalDurations({}, 1, 1999);
  expect(signalDurations(props)).toEqual({ onMs: 1, offMs: 1999, periodMs: 2000 });
  expect(signalDurations({ ...props, onTimeUnit: "s", offTimeUnit: "ms" })).toEqual(signalDurations(props));
});
it("loads existing period and percentage configurations", () => {
  expect(signalDurations({ periodMs: 3000n, dutyCycle: 50n })).toEqual({ onMs: 1500, offMs: 1500, periodMs: 3000 });
});
