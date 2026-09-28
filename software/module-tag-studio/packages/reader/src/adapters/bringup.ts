import type { NfcReader, ReaderState, ScanResult } from "../types.js";

type JsonEvent = { event: string; [key: string]: unknown };

export class BringupReader implements NfcReader {
  readonly kind = "bringup" as const;
  private state: ReaderState = "disconnected";
  private baseUrl = "http://127.0.0.1:8787";
  private port = "";
  private busy = false;

  getState(): ReaderState {
    return this.state;
  }

  async connect(options?: { port?: string; baseUrl?: string }): Promise<void> {
    this.state = "connecting";
    if (options?.baseUrl) this.baseUrl = options.baseUrl.replace(/\/$/, "");
    if (options?.port) this.port = options.port;
    const health = await fetch(`${this.baseUrl}/health`);
    if (!health.ok) {
      this.state = "error_recoverable";
      throw new Error("reader server unavailable — start npm run dev:server");
    }
    this.state = "ready";
  }

  async disconnect(): Promise<void> {
    this.state = "disconnected";
  }

  private async withBusy<T>(next: ReaderState, fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("reader busy: concurrent NFC operations are blocked");
    this.busy = true;
    this.state = next;
    try {
      return await fn();
    } catch (cause) {
      this.state = "error_recoverable";
      throw cause;
    } finally {
      this.busy = false;
      if (this.state !== "error_recoverable" && this.state !== "error_fatal") this.state = "ready";
    }
  }

  private async rpc(body: Record<string, unknown>): Promise<JsonEvent> {
    const response = await fetch(`${this.baseUrl}/nfc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ port: this.port || undefined, ...body }),
    });
    const json = (await response.json()) as JsonEvent & { error?: string };
    if (!response.ok) throw new Error(json.error ?? `reader RPC failed (${response.status})`);
    return json;
  }

  async scan(antenna: 1 | 2 = 1): Promise<ScanResult> {
    return this.withBusy("waiting_for_tag", async () => {
      const event = await this.rpc({ cmd: "scan", antenna });
      if (!event.found) return { found: false, antenna, uid: "", model: "" };
      this.state = "tag_detected";
      return {
        found: true,
        antenna: (event.antenna as 1 | 2) ?? antenna,
        uid: String(event.uid ?? ""),
        model: String(event.model ?? "NFC-A Type 2"),
        productCode: typeof event.product_code === "number" ? event.product_code : undefined,
        ndefAreaBytes: typeof event.ndef_area_bytes === "number" ? event.ndef_area_bytes : undefined,
      };
    });
  }

  async readPage(page: number): Promise<Uint8Array> {
    return this.withBusy("reading", async () => {
      const event = await this.rpc({ cmd: "read", antenna: 1, page, count: 1 });
      const pages = event.pages as { page: number; bytes: number[] }[] | undefined;
      const row = pages?.[0];
      if (!row?.bytes || row.bytes.length !== 4) throw new Error(`read page ${page} failed`);
      return Uint8Array.from(row.bytes);
    });
  }

  async writePage(page: number, data: Uint8Array): Promise<void> {
    await this.withBusy("writing", async () => {
      if (data.length !== 4) throw new Error("page must be 4 bytes");
      await this.rpc({
        cmd: "write",
        antenna: 1,
        page,
        data: Array.from(data),
        force: page === 2 || page === 44,
      });
    });
  }

  async readAllPages(): Promise<Map<number, Uint8Array>> {
    return this.withBusy("reading", async () => {
      const event = await this.rpc({ cmd: "read", antenna: 1, page: 0, count: 64 });
      const pages = event.pages as { page: number; bytes: number[] }[] | undefined;
      if (!pages || pages.length !== 64) throw new Error("full dump failed");
      const map = new Map<number, Uint8Array>();
      for (const row of pages) map.set(row.page, Uint8Array.from(row.bytes));
      return map;
    });
  }
}
