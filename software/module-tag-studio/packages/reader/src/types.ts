export type ReaderState =
  | "disconnected"
  | "connecting"
  | "ready"
  | "waiting_for_tag"
  | "tag_detected"
  | "reading"
  | "writing"
  | "verifying"
  | "locking"
  | "completed"
  | "error_recoverable"
  | "error_fatal";

export type ScanResult = {
  found: boolean;
  antenna: 1 | 2;
  uid: string;
  model: string;
  productCode?: number;
  ndefAreaBytes?: number;
};

export type NfcReader = {
  readonly kind: "simulated" | "bringup";
  getState(): ReaderState;
  connect(options?: { port?: string; baseUrl?: string }): Promise<void>;
  disconnect(): Promise<void>;
  scan(antenna?: 1 | 2): Promise<ScanResult>;
  readPage(page: number): Promise<Uint8Array>;
  writePage(page: number, data: Uint8Array): Promise<void>;
  readAllPages(): Promise<Map<number, Uint8Array>>;
};
