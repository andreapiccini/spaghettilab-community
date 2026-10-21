import type {
  SpaghettiClient,
  ApplyPhysicalRequest,
  GetConfigResponse,
} from "@spaghettilab/protocol-sdk";
import { DEFAULT_PHYSICAL_SETTINGS } from "@spaghettilab/protocol-sdk";
import {
  topologyForBoard,
  adaptPhysicalModes,
  tagForSlot,
  expectedFunctionTag,
} from "./backbone-physical.js";
import { modulePinsAlreadyConfigured } from "./module-operation.js";
import { applyStoppedRuntime, waitConfigWriteGap } from "./stop-deployed-runtime.js";

const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((value, index) => value === b[index]);
/** Rebind authored pin settings to replacement boards before validating drivers.
 * Keep rollback state only for the duration of this deployment. */
export async function prepareDeploymentPhysical(
  gateway: SpaghettiClient,
  requests: readonly ApplyPhysicalRequest[],
  signal: AbortSignal,
  phase: (text: string) => void,
) {
  const status = await gateway.getStatus(signal);
  const targets: {
    request: ApplyPhysicalRequest;
    previous: ApplyPhysicalRequest;
    client: SpaghettiClient;
    original: GetConfigResponse;
    stopped?: GetConfigResponse;
    touched: boolean;
  }[] = [];
  let committed = false;
  const dispose = () =>
    targets.forEach((target) => {
      if (target.client !== gateway) target.client.dispose();
    });
  const rollback = async () => {
    if (committed) return;
    const failures: string[] = [];
    for (const target of [...targets].reverse()) {
      if (!target.touched) continue;
      try {
        const live = await target.client.getConfig();
        if (
          !equal(live.configBytes, target.original.configBytes) &&
          (!target.stopped || !equal(live.configBytes, target.stopped.configBytes))
        )
          throw new Error("programma cambiato durante il caricamento");
        await applyStoppedRuntime(target.client);
        const fresh = await gateway.getStatus();
        const board = {
          local: target.request.nodeId === 0,
          nodeId: target.request.nodeId,
        };
        await gateway.applyPhysical({
          ...target.previous,
          expectedTag: expectedFunctionTag(tagForSlot(fresh, board, 2), false),
        });
        await waitConfigWriteGap();
        const current = await target.client.getConfig();
        await target.client.applyConfig({
          expectedGeneration: current.generation,
          configBytes: target.original.configBytes,
        });
        if (
          !equal(
            (await target.client.getConfig()).configBytes,
            target.original.configBytes,
          )
        )
          throw new Error("programma originale non confermato");
        target.touched = false;
      } catch (error) {
        failures.push(
          `Pin Backbone ${target.request.nodeId || "USB"}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (failures.length)
      throw new Error(`Ripristino incompleto: ${failures.join("; ")}`);
  };
  try {
    // Check every board and snapshot every program before changing any pin.
    for (const authored of requests) {
      let request = authored;
      const board = { local: request.nodeId === 0, nodeId: request.nodeId };
      const actual = topologyForBoard(status, board);
      if (!actual)
        throw new Error(
          "Una Backbone del progetto non è più connessa. Ricontrolla prima del caricamento.",
        );
      request = {
        ...request,
        modes: new Uint8Array(
          adaptPhysicalModes(Array.from(request.modes), actual.modes.length),
        ),
      };
      const planned = {
        name: "Function",
        modes: Array.from(request.modes),
        i2cSpeed: request.i2cSpeed,
        settings: request.settings,
      };
      if (modulePinsAlreadyConfigured(actual, planned)) continue;
      const client = board.local ? gateway : gateway.forCanNode(board.nodeId);
      try {
        const original = await client.getConfig(signal);
        targets.push({
          request: {
            ...request,
            settings:
              actual.version >= 2
                ? (request.settings ?? DEFAULT_PHYSICAL_SETTINGS)
                : undefined,
          },
          previous: {
            nodeId: request.nodeId,
            modes: new Uint8Array(actual.modes),
            i2cSpeed: actual.i2cSpeed,
            settings: actual.settings,
          },
          client,
          original,
          touched: false,
        });
      } catch (error) {
        if (client !== gateway) client.dispose();
        throw error;
      }
    }
    for (const target of targets) {
      phase(`Configurazione pin · Backbone ${target.request.nodeId ? "CAN" : "USB"}…`);
      target.touched = true;
      target.stopped = (await applyStoppedRuntime(target.client, signal)).config;
      const fresh = await gateway.getStatus(signal);
      const board = {
        local: target.request.nodeId === 0,
        nodeId: target.request.nodeId,
      };
      await gateway.applyPhysical(
        {
          ...target.request,
          expectedTag: expectedFunctionTag(tagForSlot(fresh, board, 2), false),
        },
        signal,
      );
      const confirmed = topologyForBoard(await gateway.getStatus(signal), board);
      if (
        !modulePinsAlreadyConfigured(confirmed, {
          name: "Function",
          modes: Array.from(target.request.modes),
          i2cSpeed: target.request.i2cSpeed,
          settings: target.request.settings,
        })
      )
        throw new Error("La configurazione dei pin non è stata confermata.");
      await waitConfigWriteGap(signal);
    }
  } catch (error) {
    try {
      await rollback();
    } catch (restore) {
      throw new Error(`${String(error)} · ${String(restore)}`);
    } finally {
      dispose();
    }
    throw error;
  }
  return {
    gatewayGeneration: targets.find((target) => target.request.nodeId === 0)?.stopped
      ?.generation,
    rollback,
    dispose,
    commit() {
      committed = true;
    },
  };
}
