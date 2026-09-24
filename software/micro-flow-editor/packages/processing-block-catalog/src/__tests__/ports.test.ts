import { describe, expect, it } from "vitest";
import {
  T,
  catalogPortsCompatible,
  inPort,
  outPort,
  portTypesCompatible,
  resolvePortTypes,
  rolesCompatible,
} from "../ports.js";

describe("port compatibility", () => {
  it("activation is a jolly that matches any input type", () => {
    expect(portTypesCompatible(T.activationTrigger, T.digitalComando)).toBe(true);
    expect(portTypesCompatible(T.activationTrigger, T.analogComando)).toBe(true);
    expect(portTypesCompatible(T.activationTrigger, T.eventTrigger)).toBe(true);
  });

  it("requires matching domain for non-activation", () => {
    expect(portTypesCompatible(T.digitalComando, T.analogComando)).toBe(false);
    expect(portTypesCompatible(T.digitalComando, T.digitalComando)).toBe(true);
  });

  it("rolesCompatible follows the policy table", () => {
    expect(rolesCompatible("comando", "comando")).toBe(true);
    expect(rolesCompatible("misura", "comando")).toBe(true);
    expect(rolesCompatible("trigger", "misura")).toBe(false);
  });

  it("resolvePortTypes specializes activation to the target type", () => {
    const out = outPort("0", [T.activationTrigger]);
    const inn = inPort("0", [T.digitalComando, T.analogComando]);
    expect(resolvePortTypes(out, inn)).toEqual(T.digitalComando);
  });

  it("catalogPortsCompatible for Schedule → Toggle and Toggle → LED", () => {
    const scheduleOut = [outPort("0", [T.activationTrigger, T.eventTrigger])];
    const toggleIn = [inPort("0", [T.activationTrigger, T.eventTrigger, T.digitalComando])];
    const toggleOut = [outPort("0", [T.digitalComando])];
    const ledIn = [inPort("0", [T.digitalComando, T.analogComando])];
    expect(catalogPortsCompatible(scheduleOut, toggleIn)).toBe(true);
    expect(catalogPortsCompatible(toggleOut, ledIn)).toBe(true);
    expect(catalogPortsCompatible([], toggleIn)).toBe(false);
  });
});
