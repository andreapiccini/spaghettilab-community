import { describe, it, expect, vi } from "vitest";
import type { SpaghettiClient } from "@spaghettilab/protocol-sdk";
import { createNfcMemoryBridge } from "../nfc-memory-bridge.js";
const target = {
  bindingId: "master-a",
  nodeId: 0xe18030,
  antenna: 2,
  expectedUid: "0474C102A02190",
};
describe("NFC page routing", () => {
  it("keeps full 24-bit reader identities and does not reuse a route across Masters", async () => {
    const page = vi.fn(async (request: { page: number }) =>
      request.page === 3
        ? Uint8Array.of(0xe1, 0x10, 20, 0)
        : request.page === 45
          ? Uint8Array.of(0x90, 0x90, 0, 0)
          : new Uint8Array(4),
    );
    const clients = vi.fn(() => ({ nfcPage: page }) as unknown as SpaghettiClient);
    const bridge = createNfcMemoryBridge(clients);
    const signal = new AbortController().signal;
    expect((await bridge.read(target, signal)).writable).toBe(true);
    const second = { ...target, bindingId: "master-b", nodeId: 0x123456, antenna: 1 };
    await bridge.read(second, signal);
    expect(
      page.mock.calls
        .slice(0, 42)
        .every(([req]) => (req as { nodeId?: number }).nodeId === target.nodeId),
    ).toBe(true);
    expect(
      page.mock.calls
        .slice(42)
        .every(([req]) => (req as { nodeId?: number }).nodeId === second.nodeId),
    ).toBe(true);
    expect(clients).toHaveBeenCalledWith("master-b");
  });
  it("does not declare an unchecked tag writable or probe other readers on failure", async () => {
    const page = vi.fn(async () => new Uint8Array(4));
    const bridge = createNfcMemoryBridge(
      () => ({ nfcPage: page }) as unknown as SpaghettiClient,
    );
    expect(await bridge.read(target, new AbortController().signal)).toMatchObject({
      family: "unsupported",
      writable: false,
    });
    expect(page).toHaveBeenCalledTimes(2);
    page.mockRejectedValueOnce(new Error("Timeout"));
    await expect(bridge.read(target, new AbortController().signal)).rejects.toThrow(
      "Timeout",
    );
    expect(page).toHaveBeenCalledTimes(3);
  });
});
