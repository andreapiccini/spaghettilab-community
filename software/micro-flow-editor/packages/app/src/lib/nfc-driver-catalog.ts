import {
  resolveLibraryDriver,
  type LibraryDriver,
  type NfcLibrary,
} from "./nfc-workspace.js";
/** Remote adapters return trusted verification metadata, never trust a tag's own claims. */
export type DriverCatalogResult =
  | { state: "local"; driver: LibraryDriver; origin: "local" }
  | {
      state: "remote";
      id: string;
      version: string;
      verifiedPublisher: string;
      integritySha256: string;
    }
  | { state: "missing" }
  | { state: "not-configured"; message: string };
export interface DriverCatalogProvider {
  lookup(id: string, version?: string): Promise<DriverCatalogResult>;
  download(id: string, version: string, signal: AbortSignal): Promise<LibraryDriver>;
}
export function localDriverCatalog(library: NfcLibrary): DriverCatalogProvider {
  return {
    async lookup(id, version) {
      const driver = resolveLibraryDriver(library, id, version);
      return driver
        ? { state: "local", driver, origin: "local" }
        : { state: "missing" };
    },
    async download() {
      throw new Error("Il catalogo locale non esegue download.");
    },
  };
}
export const unconfiguredRemoteCatalog: DriverCatalogProvider = {
  async lookup() {
    return { state: "not-configured", message: "Catalogo online non configurato." };
  },
  async download() {
    throw new Error("Configura un catalogo attendibile prima di scaricare i driver.");
  },
};
