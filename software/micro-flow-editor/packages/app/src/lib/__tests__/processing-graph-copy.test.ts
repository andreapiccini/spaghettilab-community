import { describe, expect, it } from "vitest";
import { processingGraphCopy } from "../processing-graph-copy.js";

describe("processingGraphCopy schedule period", () => {
  it("uses English every-N for the compact chip", () => {
    expect(processingGraphCopy("en").everyMs(1000)).toBe("every 1s");
    expect(processingGraphCopy("en").everyMs(250)).toBe("every 250ms");
  });

  it("keeps Italian ogni-N", () => {
    expect(processingGraphCopy("it").everyMs(1000)).toBe("ogni 1s");
    expect(processingGraphCopy("it").everyMs(250)).toBe("ogni 250ms");
  });
});
