import { describe, expect, it } from "vitest";
import { PowerAdmission, RailAssurance, requiresPowerAcknowledgement } from "../power.js";

describe("requiresPowerAcknowledgement", () => {
  it("is true for an UNMANAGED (passive) rail", () => {
    expect(requiresPowerAcknowledgement(RailAssurance.UNMANAGED)).toBe(true);
  });

  it("is false for a SWITCHED or SWITCHED_AND_MEASURED rail", () => {
    expect(requiresPowerAcknowledgement(RailAssurance.SWITCHED)).toBe(false);
    expect(requiresPowerAcknowledgement(RailAssurance.SWITCHED_AND_MEASURED)).toBe(false);
  });

  it("resolves the exact numeric values from firmware/backbone/include/spaghetti/power.h", () => {
    expect(RailAssurance.UNMANAGED).toBe(0);
    expect(RailAssurance.SWITCHED).toBe(1);
    expect(RailAssurance.SWITCHED_AND_MEASURED).toBe(2);
    expect(PowerAdmission.NOT_REQUIRED).toBe(0);
    expect(PowerAdmission.UNVERIFIED).toBe(1);
    expect(PowerAdmission.ENFORCED).toBe(2);
  });
});
