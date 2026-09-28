import { PRODUCT_CODE_ST25TN01K } from "@spaghettilab/module-tag-protocol";
import type { NfcReader, ReaderState, ScanResult } from "../types.js";

export class SimulatedReader implements NfcReader {
  readonly kind = "simulated" as const;
  private state: ReaderState = "disconnected";
  private pages = new Map<number, Uint8Array>();
  private busy = false;
  private present = true;
  private antenna: 1 | 2 = 1;
  /** Fail the next write to this page once. */
  failNextWritePage: number | null = null;

  constructor() {
    this.resetMemory();
  }

  getState(): ReaderState {
    return this.state;
  }

  resetMemory(): void {
    this.pages.clear();
    for (let p = 0; p < 64; p++) this.pages.set(p, new Uint8Array(4));
    this.pages.set(0, Uint8Array.of(0x04, 0x11, 0x22, 0x33));
    this.pages.set(1, Uint8Array.of(0x44, 0x55, 0x66, 0x77));
    this.pages.set(3, Uint8Array.of(0xe1, 0x10, 0x14, 0x00));
    this.pages.set(45, Uint8Array.of(0x90, 0x90, 0x01, 0x00));
  }

  setTagPresent(present: boolean): void {
    this.present = present;
  }

  async connect(_options?: { port?: string; baseUrl?: string }): Promise<void> {
    this.state = "connecting";
    this.state = "ready";
  }

  async disconnect(): Promise<void> {
    this.state = "disconnected";
  }

  private async withBusy<T>(next: ReaderState, fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("reader busy: concurrent NFC operations are blocked");
    this.busy = true;
    const prev = this.state;
    this.state = next;
    try {
      return await fn();
    } finally {
      this.busy = false;
      this.state = prev === "disconnected" ? "disconnected" : "ready";
    }
  }

  async scan(antenna: 1 | 2 = 1): Promise<ScanResult> {
    return this.withBusy("waiting_for_tag", async () => {
      this.antenna = antenna;
      if (!this.present) return { found: false, antenna, uid: "", model: "" };
      this.state = "tag_detected";
      return {
        found: true,
        antenna,
        uid: "04:11:22:33:44:55:66",
        model: "ST25TN01K",
        productCode: PRODUCT_CODE_ST25TN01K,
        ndefAreaBytes: 160,
      };
    });
  }

  async readPage(page: number): Promise<Uint8Array> {
    return this.withBusy("reading", async () => {
      if (!this.present) throw new Error("no tag present");
      const data = this.pages.get(page);
      if (!data) throw new Error(`missing page ${page}`);
      return new Uint8Array(data);
    });
  }

  async writePage(page: number, data: Uint8Array): Promise<void> {
    await this.withBusy("writing", async () => {
      if (!this.present) throw new Error("no tag present");
      if (data.length !== 4) throw new Error("page must be 4 bytes");
      if (page <= 1) throw new Error("UID pages are read-only");
      if (this.failNextWritePage === page) {
        this.failNextWritePage = null;
        throw new Error(`simulated write failure on page ${page}`);
      }
      this.pages.set(page, new Uint8Array(data));
    });
  }

  async readAllPages(): Promise<Map<number, Uint8Array>> {
    return this.withBusy("reading", async () => {
      const out = new Map<number, Uint8Array>();
      for (let p = 0; p < 64; p++) out.set(p, new Uint8Array(this.pages.get(p)!));
      return out;
    });
  }
}
