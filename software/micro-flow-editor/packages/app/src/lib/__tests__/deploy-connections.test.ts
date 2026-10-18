import { expect, it, vi } from "vitest";
import { verifyDeployConnections } from "../deploy-connections.js";
it("checks selected live clients directly even without a background discovery result", async () => {
  const getStatus = vi.fn().mockResolvedValue({ version: "0.5.9" });
  const getClient = vi.fn().mockReturnValue({ getStatus });
  expect(
    await verifyDeployConnections(
      [{ bindingId: "master", label: "Backbone 1" }],
      getClient,
    ),
  ).toEqual([{ bindingId: "master", status: { version: "0.5.9" } }]);
  expect(getClient).toHaveBeenCalledWith("master");
  expect(getStatus).toHaveBeenCalledOnce();
});
it("does not use cached status to approve an unresponsive target", async () => {
  await expect(
    verifyDeployConnections([{ bindingId: "master", label: "Backbone 1" }], () => ({
      getStatus: () => Promise.reject(new Error("timeout")),
    })),
  ).rejects.toThrow("Backbone 1: non risponde");
  await expect(
    verifyDeployConnections(
      [{ bindingId: "missing", label: "Backbone 2" }],
      () => undefined,
    ),
  ).rejects.toThrow("Backbone 2: collegamento non disponibile");
});
it("verifies all selected boards before proceeding", async () => {
  const checked: string[] = [];
  await expect(
    verifyDeployConnections(
      [
        { bindingId: "a", label: "Backbone 1" },
        { bindingId: "b", label: "Backbone 2" },
      ],
      (id) => ({
        getStatus: async () => {
          checked.push(id);
          if (id === "b") throw new Error("USB");
          return {};
        },
      }),
    ),
  ).rejects.toThrow("Backbone 2");
  expect(checked).toEqual(["a", "b"]);
});
