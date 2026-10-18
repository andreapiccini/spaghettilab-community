import { expect, it, vi } from "vitest";
import type { SpaghettiClient } from "@spaghettilab/protocol-sdk";
import { deployWire } from "../deploy-wire.js";
it("passes cancellation to wire operations and prevents a later apply", async () => {
  const controller = new AbortController();
  const applyConfig = vi.fn();
  const getConfig = vi.fn().mockResolvedValue({});
  const phase = vi.fn();
  const client = { getConfig, applyConfig } as unknown as SpaghettiClient;
  const wire = deployWire(client, controller.signal, phase);
  await wire.getConfig();
  expect(getConfig).toHaveBeenCalledWith(controller.signal);
  expect(phase).toHaveBeenCalledWith("Verifica del programma sulla Backbone…");
  controller.abort();
  expect(() =>
    wire.applyConfig({ expectedGeneration: 1, configBytes: new Uint8Array() }),
  ).toThrow();
  expect(applyConfig).not.toHaveBeenCalled();
});
it("reports the installation phase and passes the abort signal through pagination", async () => {
  const controller = new AbortController();
  const installDeviceProfile = vi.fn().mockResolvedValue(undefined);
  const getFullDeviceProfileList = vi.fn().mockResolvedValue([]);
  const phase = vi.fn();
  const wire = deployWire(
    { installDeviceProfile, getFullDeviceProfileList } as unknown as SpaghettiClient,
    controller.signal,
    phase,
  );
  const request = { profileCbor: new Uint8Array([1]) };
  await wire.installDeviceProfile(request);
  await wire.getFullDeviceProfileList();
  expect(installDeviceProfile).toHaveBeenCalledWith(request, controller.signal);
  expect(getFullDeviceProfileList).toHaveBeenCalledWith(undefined, controller.signal);
  expect(phase.mock.calls.map((c) => c[0])).toEqual([
    "Caricamento del driver del dispositivo…",
    "Verifica dei driver installati…",
  ]);
});
