import { backboneConfigLimit } from "./backbone-config-limit.js";
import type { SpaghettiClient, GetConfigResponse } from "@spaghettilab/protocol-sdk";
import type { DriverDeploymentPlan } from "./driver-deployment-plan.js";
import { dryRunConfig, decodeConfigCbor } from "@spaghettilab/config-decompiler";
import { encodeConfigCbor } from "@spaghettilab/config-compiler";
import { installProfile } from "@spaghettilab/device-profile-install";
import { deployWire } from "./deploy-wire.js";
import { oneShotDeploymentInput } from "./one-shot-deployment.js";
import {
  pauseContinuousRuntime,
  readOwnedDriverProfiles,
  ownedDriverProfileKey,
  waitConfigWriteGap,
  isRetryableConfigApply,
  readConfigForStop,
} from "./stop-deployed-runtime.js";
import { installDriverProfiles } from "./driver-profile-deployment.js";

export type RemotePlan = {
  readonly nodeId: number;
  readonly label: string;
  readonly plan: DriverDeploymentPlan;
};
export function supportsDistributedFirmware(version: string | undefined): boolean {
  const v = version?.match(/^(\d+)\.(\d+)\.(\d+)/);
  return (
    !!v &&
    (Number(v[1]) > 0 || Number(v[2]) > 5 || (Number(v[2]) === 5 && Number(v[3]) >= 49))
  );
}
export function completionProfileIds(plan: DriverDeploymentPlan): string[] {
  return plan.profiles
    .filter(
      (profile) =>
        profile.profileId.startsWith("flow.gpio-state.") ||
        profile.sampleOps.some((op) =>
          ["DS18B20_READ", "DHT22_READ", "STEPPER", "RGB_PROGRAM"].includes(op.op),
        ),
    )
    .map((profile) => profile.profileId);
}
const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const stateKey = (project: string) => `spaghettilab.distributed:${project}`;
type Participant = { nodeId: number; completionProfiles: readonly string[] };
export function rememberDistributedDeployment(
  project: string,
  participants: readonly Participant[],
  manual: boolean,
): void {
  try {
    localStorage.setItem(
      stateKey(project),
      JSON.stringify({ participants, mode: manual ? "one-shot" : "continuous" }),
    );
  } catch {
    /* optional persistence */
  }
}
export async function pauseDistributedParticipants(
  gateway: SpaghettiClient,
  project: string,
  signal: AbortSignal,
  phase: (label: string) => void,
  confirmedUsbConfig?: GetConfigResponse,
): Promise<void> {
  let participants: Participant[] = [];
  try {
    const saved = JSON.parse(localStorage.getItem(stateKey(project)) ?? "{}");
    if (Array.isArray(saved.participants)) participants = saved.participants;
  } catch {
    /* no previous distributed deployment */
  }
  if (!participants.length) return;
  const status = await gateway.getStatus(signal);
  const local =
    status.deviceId && status.deviceId.length >= 6
      ? (status.deviceId[3]! << 16) | (status.deviceId[4]! << 8) | status.deviceId[5]!
      : undefined;
  // Saved participants describe the last deployment, not the currently attached
  // hardware. Only stop peers actually referenced by the running USB program.
  const live = confirmedUsbConfig ?? (await readConfigForStop(gateway, signal));
  const decoded = decodeConfigCbor(live.configBytes);
  if (!decoded.ok)
    throw new Error("Configurazione USB non leggibile: Stop non confermato.");
  const activePeers = new Set(
    decoded.value.modules
      .filter((module) => module.typeId === "can-link")
      .map((module) => Number(module.properties[1])),
  );
  participants = participants.filter(
    (participant) =>
      participant.nodeId === local || activePeers.has(participant.nodeId),
  );
  for (const participant of participants) {
    if (participant.nodeId === local) continue;
    const peer = status.chainPeers?.find((peer) => peer.nodeId === participant.nodeId);
    if (!peer)
      throw new Error(
        `La Backbone CAN ${participant.nodeId.toString(16).toUpperCase()} non è raggiungibile: Stop non confermato.`,
      );
    phase(`Stop · Backbone CAN ${participant.nodeId.toString(16).toUpperCase()}…`);
    const client = gateway.forCanNode(participant.nodeId);
    try {
      await pauseContinuousRuntime(client, signal, participant.completionProfiles);
    } finally {
      client.dispose();
    }
  }
  rememberDistributedDeployment(project, participants, true);
}

/** Prepare every target before the first configuration write. Drivers are installed
 * first because firmware validation resolves their schemas from the local library. */
export async function prepareRemoteDeployment(
  gateway: SpaghettiClient,
  plans: readonly RemotePlan[],
  signal: AbortSignal,
  phase: (label: string) => void,
  manual: boolean,
) {
  const targets: {
    entry: RemotePlan;
    client: SpaghettiClient;
    original: GetConfigResponse;
    bytes: Uint8Array;
    applied?: GetConfigResponse;
    uncertain?: boolean;
    cleanup?: () => Promise<void>;
  }[] = [];
  let committed = false;
  const dispose = () => {
    for (const target of targets) target.client.dispose();
  };
  const rollback = async () => {
    if (committed) return;
    const failures: string[] = [];
    for (const target of [...targets].reverse()) {
      if (!target.applied && !target.uncertain) continue;
      try {
        phase(`Ripristino · ${target.entry.label}…`);
        const now = await target.client.getConfig();
        if (target.uncertain && equal(now.configBytes, target.original.configBytes)) {
          target.uncertain = false;
          continue;
        }
        if (
          (target.applied && now.generation !== target.applied.generation) ||
          !equal(now.configBytes, target.bytes)
        )
          throw new Error("configurazione cambiata nel frattempo");
        await waitConfigWriteGap();
        await target.client.applyConfig({
          expectedGeneration: now.generation,
          configBytes: target.original.configBytes,
        });
        const restored = await target.client.getConfig();
        if (!equal(restored.configBytes, target.original.configBytes))
          throw new Error("ripristino non confermato");
        target.applied = undefined;
        target.uncertain = false;
      } catch (error) {
        failures.push(
          `${target.entry.label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (failures.length)
      throw new Error(`Ripristino incompleto: ${failures.join("; ")}`);
  };
  try {
    const gatewayStatus = plans.length ? await gateway.getStatus(signal) : undefined;
    for (const entry of plans) {
      signal.throwIfAborted();
      phase(`Verifica · ${entry.label}…`);
      const peer = gatewayStatus?.chainPeers?.find(
        (peer) => peer.nodeId === entry.nodeId && !peer.local,
      );
      if (!peer) throw new Error(`${entry.label}: non è connessa.`);
      const client = gateway.forCanNode(entry.nodeId);
      let retained = false;
      try {
        const status = await client.getStatus(signal);
        if (!supportsDistributedFirmware(status.version))
          throw new Error(
            `${entry.label}: aggiorna il firmware a 0.5.49 per il programma distribuito.`,
          );
        if (
          !status.deviceId ||
          !peer.mac.every((byte, index) => byte === status.deviceId![index])
        )
          throw new Error(
            `${entry.label}: identità della scheda diversa da quella rilevata.`,
          );
        const original = await client.getConfig(signal);
        const decoded = decodeConfigCbor(original.configBytes);
        if (!decoded.ok)
          throw new Error(`${entry.label}: configurazione attuale non leggibile.`);
        const prepared = manual
          ? oneShotDeploymentInput(entry.plan.input, completionProfileIds(entry.plan))
          : entry.plan.input;
        const input = {
          ...prepared,
          mqtt: decoded.value.mqtt,
          connectivity: decoded.value.connectivity,
          energy: decoded.value.energy,
        };
        const compiled = dryRunConfig(input, entry.plan.options);
        if (!compiled.compiled)
          throw new Error(
            `${entry.label}: ${compiled.issues.map((issue) => issue.remediation).join("; ")}`,
          );
        const bytes = encodeConfigCbor(compiled.compiled);
        const capabilities = await client.getCapabilities(signal);
        const limit = backboneConfigLimit(capabilities.coreVariant, status.version);
        if (limit !== undefined && bytes.length > limit)
          throw new Error(
            `${entry.label}: programma di ${bytes.length} byte, massimo ${limit}.`,
          );
        targets.push({ entry, client, original, bytes });
        retained = true;
      } finally {
        if (!retained) client.dispose();
      }
    }
    for (const target of targets) {
      const wire = {
        ...deployWire(target.client, signal, phase),
        getFullDeviceProfileList: () =>
          target.client.getFullDeviceProfileList(3, signal),
      };
      const status = await target.client.getStatus(signal);
      const deviceId = Array.from(status.deviceId ?? [], (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      phase(`Driver · ${target.entry.label}…`);
      target.cleanup = await installDriverProfiles(
        target.entry.plan.profiles,
        readOwnedDriverProfiles(deviceId),
        {
          install: async (profile) => {
            const result = await installProfile(wire, profile, { reuseInstalled: true });
            if (!result.ok)
              throw new Error(`${target.entry.label}: ${result.error.remediation}`);
          },
          remove: async (id, version) => {
            try {
              await wire.removeDeviceProfile({
                idBytes: new TextEncoder().encode(id),
                version,
              });
              return true;
            } catch {
              return false;
            }
          },
          remember: (profiles) => {
            try {
              localStorage.setItem(
                ownedDriverProfileKey(deviceId),
                JSON.stringify(profiles),
              );
            } catch {
              /* optional */
            }
          },
        },
      );
    }
    for (const target of targets) {
      phase(`Controllo programma · ${target.entry.label}…`);
      const valid = await target.client.validateConfig(
        { configBytes: target.bytes },
        signal,
      );
      if (!valid.valid)
        throw new Error(
          `${target.entry.label}: programma non valido (campo ${valid.failureField}, indice ${valid.failureIndex}, motivo ${valid.failureReason}).`,
        );
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    async apply() {
      for (const target of targets) {
        phase(`Caricamento · ${target.entry.label}…`);
        if (equal(target.original.configBytes, target.bytes)) continue;
        try {
          target.uncertain = true;
          try {
            await target.client.applyConfig(
              {
                expectedGeneration: target.original.generation,
                configBytes: target.bytes,
              },
              signal,
            );
          } catch (error) {
            if (!isRetryableConfigApply(error)) throw error;
            await waitConfigWriteGap(signal);
            await target.client.applyConfig(
              {
                expectedGeneration: target.original.generation,
                configBytes: target.bytes,
              },
              signal,
            );
          }
          const live = await target.client.getConfig(signal);
          if (!equal(live.configBytes, target.bytes))
            throw new Error("lettura di conferma diversa dal programma inviato");
          target.applied = live;
          target.uncertain = false;
        } catch (error) {
          // A lost reply can follow a successful write. Only claim success after read-back.
          try {
            const live = await target.client.getConfig(signal);
            if (equal(live.configBytes, target.bytes)) {
              target.applied = live;
              target.uncertain = false;
              continue;
            }
          } catch {
            /* leave uncertainty explicit */
          }
          throw new Error(
            `${target.entry.label}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    },
    async commit(
      project: string,
      hostNodeId: number | undefined,
      hostPlan: DriverDeploymentPlan,
    ) {
      committed = true;
      rememberDistributedDeployment(
        project,
        [
          ...(hostNodeId
            ? [
                {
                  nodeId: hostNodeId,
                  completionProfiles: completionProfileIds(hostPlan),
                },
              ]
            : []),
          ...plans.map((entry) => ({
            nodeId: entry.nodeId,
            completionProfiles: completionProfileIds(entry.plan),
          })),
        ],
        manual,
      );
      for (const target of targets)
        try {
          await target.cleanup?.();
        } catch {
          /* Config already confirmed; cleanup can wait. */
        }
    },
    rollback,
    dispose,
  };
}

export function requireProgramFirmware(
  plan: DriverDeploymentPlan,
  version: string | undefined,
  label: string,
): void {
  const pwm = plan.profiles.some((profile) =>
    [...profile.initOps, ...profile.sampleOps, ...profile.safeStopOps].some(
      (op) => op.op === "PWM_SET",
    ),
  );
  if (!pwm) return;
  const v = version?.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (
    !v ||
    !(
      Number(v[1]) > 0 ||
      Number(v[2]) > 5 ||
      (Number(v[2]) === 5 && Number(v[3]) >= 52)
    )
  )
    throw new Error(
      `${label}: le istruzioni PWM del modulo richiedono il firmware 0.5.52 o successivo.`,
    );
}
