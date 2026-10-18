import type { SpaghettiClient } from "@spaghettilab/protocol-sdk";
/** Abort reaches every wire request; a cancelled workflow cannot start a later APPLY_CONFIG. */
export function deployWire(
  client: SpaghettiClient,
  signal: AbortSignal,
  phase: (label: string) => void,
) {
  const run = <T>(label: string, request: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    phase(label);
    return request();
  };
  return {
    getStatus: () => run("Verifica del collegamento…", () => client.getStatus(signal)),
    getConfig: () =>
      run("Verifica del programma sulla Backbone…", () => client.getConfig(signal)),
    validateConfig: (request: Parameters<SpaghettiClient["validateConfig"]>[0]) =>
      run("Controllo del programma sulla Backbone…", () =>
        client.validateConfig(request, signal),
      ),
    applyConfig: (request: Parameters<SpaghettiClient["applyConfig"]>[0]) =>
      run("Avvio del programma sulla Backbone…", () =>
        client.applyConfig(request, signal),
      ),
    validateDeviceProfile: (
      request: Parameters<SpaghettiClient["validateDeviceProfile"]>[0],
    ) =>
      run("Controllo del driver del dispositivo…", () =>
        client.validateDeviceProfile(request, signal),
      ),
    installDeviceProfile: (
      request: Parameters<SpaghettiClient["installDeviceProfile"]>[0],
    ) =>
      run("Caricamento del driver del dispositivo…", () =>
        client.installDeviceProfile(request, signal),
      ),
    removeDeviceProfile: (
      request: Parameters<SpaghettiClient["removeDeviceProfile"]>[0],
    ) =>
      run("Rimozione dei driver precedenti non utilizzati…", () =>
        client.removeDeviceProfile(request, signal),
      ),
    getFullDeviceProfileList: () =>
      run("Verifica dei driver installati…", () =>
        client.getFullDeviceProfileList(undefined, signal),
      ),
  };
}
