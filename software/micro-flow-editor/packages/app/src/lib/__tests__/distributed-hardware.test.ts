/** Explicit opt-in hardware qualification. Saves/restores both programs and only
 * removes profiles created by this test. Requires the named V2 boards and RGB A0-A2. */
import { readFileSync, writeFileSync } from "node:fs";
import { it, expect } from "vitest";
import {
  SpaghettiClient,
  WebSocketProtocolTransport,
  decodeEvent,
  decodeRecordEventPayload,
  EventType,
  type RecordEventPayload,
} from "@spaghettilab/protocol-sdk";
import { decodeConfigCbor } from "@spaghettilab/config-decompiler";
import { deployConfig, DeploymentOutcomeKind } from "@spaghettilab/config-deployment";
import { installProfile } from "@spaghettilab/device-profile-install";
import { deploymentId, type ProjectV1 } from "@spaghettilab/domain";
import { compileConfig, encodeConfigCbor } from "@spaghettilab/config-compiler";
import { rgbModuleDraft, defaultRgbModule } from "../rgb-module.js";
import { planModuleImport, commitModuleImport } from "../module-import.js";
import { prepareDistributedDeployment } from "../distributed-deployment-plan.js";
import { prepareRemoteDeployment } from "../distributed-deployment.js";
import { manualTriggerProfileId, sendManualTrigger } from "../flow-trigger.js";
const enabled = process.env.RUN_DISTRIBUTED_HARDWARE === "1";
it.skipIf(!enabled)(
  "runs a generator on USB, the RGB driver on CAN, and returns boolean/color viewer records",
  async () => {
    const usb = "907069e1c4fc" + "0".repeat(52),
      node = 0xe17fd0;
    const socket = new WebSocket(`ws://127.0.0.1:8766/core/${usb}`);
    socket.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const transport = new WebSocketProtocolTransport({
      send: (bytes) => socket.send(bytes),
      onMessage: (handler) => {
        const listener = (event: MessageEvent) => handler(new Uint8Array(event.data));
        socket.addEventListener("message", listener);
        return () => socket.removeEventListener("message", listener);
      },
    });
    const client = new SpaghettiClient(transport, {
        defaultTimeoutMs: 10000,
        attemptTimeoutMs: 9000,
        maxRetries: 0,
      }),
      peer = client.forCanNode(node);
    let tx: Awaited<ReturnType<typeof prepareRemoteDeployment>> | undefined;
    let original: Awaited<ReturnType<typeof client.getConfig>> | undefined;
    let candidateBytes: Uint8Array | undefined;
    const newHostProfiles: string[] = [],
      newRemoteProfiles: string[] = [];
    const records: { n: number; record: RecordEventPayload }[] = [];
    let count = 0;
    const unsubscribe = transport.onEvent((bytes) => {
      const event = decodeEvent(bytes);
      if (event.type === EventType.RECORD) {
        records.push({ n: ++count, record: decodeRecordEventPayload(event.payload) });
        if (records.length > 256) records.shift();
      }
    });
    const equal = (a: Uint8Array, b: Uint8Array) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    try {
      expect((await client.getStatus()).deviceId?.slice(0, 6)).toEqual(
        new Uint8Array([0x90, 0x70, 0x69, 0xe1, 0xc4, 0xfc]),
      );
      const peerStatus = await peer.getStatus();
      expect(peerStatus.deviceId?.slice(0, 6)).toEqual(
        new Uint8Array([0x90, 0x70, 0x69, 0xe1, 0x7f, 0xd0]),
      );
      expect(Array.from(peerStatus.physical?.slice(7, 10) ?? [])).toEqual([12, 12, 12]);
      original = await client.getConfig();
      const remoteOriginal = await peer.getConfig();
      writeFileSync(
        "/private/tmp/distributed47-e2e-usb-original.cbor",
        original.configBytes,
      );
      writeFileSync(
        "/private/tmp/distributed47-e2e-can-original.cbor",
        remoteOriginal.configBytes,
      );
      const decoded = decodeConfigCbor(original.configBytes);
      if (!decoded.ok) throw new Error("Unreadable USB config");
      const base = {
        coreBindings: [
          { bindingId: "master", expectedDeviceId: usb, connectionProfileId: "usb" },
        ],
        physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
        deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
        authoringMetadata: {},
      } as unknown as ProjectV1;
      const proposal = planModuleImport(
        base,
        "master",
        `master:${"907069e17fd0".padEnd(64, "0")}`,
        rgbModuleDraft({
          ...defaultRgbModule(),
          inputs: [
            ...defaultRgbModule().inputs.slice(0, 3),
            {
              id: "off-input",
              name: "Spegni",
              mode: "trigger",
              actionId: "off",
              edge: "rising",
            },
          ],
        }),
        {
          name: "Function",
          variant: "v2",
          modes: [12, 12, 12, 0, 0, 0, 0, 0],
          i2cSpeed: 0,
          local: false,
          nodeId: node,
          backendPortId: 0,
        },
      );
      const imported = commitModuleImport(
          base,
          proposal,
          "hardware-qualification",
          false,
          true,
        ),
        graph = imported.deviceGraphs[0]!,
        led = graph.nodes[0]!.id;
      const plan = prepareDistributedDeployment(imported, "master", {
        physicalGraph: imported.physicalGraphs[0]!,
        processingGraph: {
          ...graph,
          nodes: [
            ...graph.nodes,
            ...Array.from({ length: 4 }, (_, index) => ({
              layer: "device-processing" as const,
              id: `capacity-probe-${index}`,
              data: {
                kind: "block" as const,
                blockTypeId: "led_driver",
                properties: {},
              },
            })),
            ...["on", "off"].map((id) => ({
              layer: "device-processing" as const,
              id: `qualification-${id}`,
              data: {
                kind: "block" as const,
                blockTypeId: "ui.manual_trigger",
                properties: {},
              },
            })),
            {
              layer: "device-processing",
              id: "colors",
              data: {
                kind: "block",
                blockTypeId: "led_driver",
                properties: {
                  ledDriverConfig: JSON.stringify({
                    outputMode: "hex",
                    presets: [
                      { id: "0", name: "Color", color: "#204060", level: "high" },
                      { id: "1", name: "Off", color: "#000000", level: "high" },
                    ],
                  }),
                },
              },
            },
            ...["state", "color"].map((id) => ({
              layer: "device-processing" as const,
              id: `viewer-${id}`,
              data: {
                kind: "block" as const,
                blockTypeId: "ui.data_viewer",
                properties: {},
              },
            })),
          ],
          edges: [
            {
              id: "activate-color",
              source: "qualification-on",
              sourceHandle: "0",
              target: "colors",
              targetHandle: "0",
            },
            {
              id: "activate-off",
              source: "qualification-off",
              sourceHandle: "0",
              target: led,
              targetHandle: "off-input",
            },
            {
              id: "to-led",
              source: "colors",
              sourceHandle: "0",
              target: led,
              targetHandle: "color-input",
            },
            ...["state", "color"].map((id) => ({
              id: `from-led-${id}`,
              source: led,
              sourceHandle: id,
              target: `viewer-${id}`,
              targetHandle: "0",
            })),
          ],
        },
        mqtt: decoded.value.mqtt,
        connectivity: decoded.value.connectivity,
        energy: decoded.value.energy,
      });
      const hostProfiles = new Set(
        (await client.getFullDeviceProfileList(3)).map((profile) => profile.profileId),
      );
      const remoteProfiles = new Set(
        (await peer.getFullDeviceProfileList(3)).map((profile) => profile.profileId),
      );
      for (const profile of plan.profiles) {
        if (!hostProfiles.has(profile.profileId))
          newHostProfiles.push(profile.profileId);
        const result = await installProfile(client, profile);
        if (!result.ok) throw new Error(result.error.remediation);
      }
      for (const profile of plan.remotePlans[0]!.plan.profiles)
        if (!remoteProfiles.has(profile.profileId))
          newRemoteProfiles.push(profile.profileId);
      tx = await prepareRemoteDeployment(
        client,
        plan.remotePlans,
        AbortSignal.timeout(60000),
        (label) => console.log("PHASE", label),
        false,
      );
      const compiled = compileConfig(plan.input, plan.options);
      if (!compiled.ok) throw new Error("USB compile failed");
      candidateBytes = encodeConfigCbor(compiled.value);
      expect((await client.validateConfig({ configBytes: candidateBytes })).valid).toBe(
        true,
      );
      await tx.apply();
      const id = deploymentId(crypto.randomUUID());
      if (!id.ok) throw new Error("Deployment ID");
      const result = await deployConfig(client, plan.input, {
        ...plan.options,
        expectedGeneration: original.generation,
        sourceProjectHash: "hardware-qualification",
        target: "master",
        deploymentId: id.value,
        timestamp: new Date().toISOString(),
      });
      console.log("MASTER_DEPLOY", result.outcome, result.issues);
      expect([DeploymentOutcomeKind.SUCCESS, DeploymentOutcomeKind.NO_OP]).toContain(
        result.outcome,
      );
      const hostConfig = decodeConfigCbor((await client.getConfig()).configBytes),
        remoteConfig = decodeConfigCbor((await peer.getConfig()).configBytes);
      if (!hostConfig.ok || !remoteConfig.ok) throw new Error("Read-back decode");
      const localRgb = hostConfig.value.modules.filter((module) =>
        String(module.properties[1]).startsWith("rgb."),
      );
      const remoteRgb = remoteConfig.value.modules.filter((module) =>
        String(module.properties[1]).startsWith("rgb."),
      );
      expect(localRgb).toHaveLength(0);
      expect(remoteRgb).toHaveLength(1);
      expect(
        (await peer.getStatus()).modules.find(
          (module) => module.key === remoteRgb[0]!.key,
        )?.endpointKind,
      ).toBe(4);
      console.log("DISTRIBUTION_CONFIRMED", {
        usbBytes: candidateBytes.length,
        canBytes: (await peer.getConfig()).configBytes.length,
        remoteRgbKey: remoteRgb[0]!.key,
      });
      const state = plan.observations!.find(
          (item) => item.viewerId === "viewer-state",
        )!,
        color = plan.observations!.find((item) => item.viewerId === "viewer-color")!;
      for (const action of ["on", "off", "on", "off"]) {
        const start = count;
        const trigger = hostConfig.value.modules.find(
          (module) =>
            module.properties[1] === manualTriggerProfileId(`qualification-${action}`),
        )!;
        await sendManualTrigger((commandId) =>
          client.moduleCommand({ key: trigger.key, commandId }),
        );
        const expectedColor = action === "on" ? 0x204060n : 0n,
          expectedState = action === "on" ? 1n : 0n;
        const matches = (observation: typeof state, value: bigint) =>
          records.some(
            ({ n, record }) =>
              n > start &&
              record.sourceKey === observation.key &&
              record.fields?.[observation.field] !== undefined &&
              BigInt(record.fields[observation.field] as bigint) === value,
          );
        const deadline = Date.now() + 5000;
        while (
          Date.now() < deadline &&
          (!matches(color, expectedColor) || !matches(state, expectedState))
        )
          await new Promise((resolve) => setTimeout(resolve, 20));
        if (!matches(color, expectedColor) || !matches(state, expectedState))
          console.log("MISSING_COLOR_RECORDS", {
            state,
            color,
            records: records.slice(-16).map((item) => ({
              key: item.record.sourceKey,
              schema: item.record.schemaId,
              fields: item.record.fields,
            })),
          });
        expect(matches(color, expectedColor), `Color ${action} through CAN`).toBe(true);
        expect(matches(state, expectedState), `Boolean ${action} through CAN`).toBe(
          true,
        );
        console.log(
          "CAN_ACTION_AND_VIEWERS",
          action,
          expectedColor.toString(16),
          "PASS",
        );
      }
    } finally {
      try {
        if (original && candidateBytes) {
          const live = await client.getConfig();
          if (equal(live.configBytes, candidateBytes)) {
            await new Promise((resolve) => setTimeout(resolve, 1100));
            await client.applyConfig({
              expectedGeneration: live.generation,
              configBytes: original.configBytes,
            });
          } else
            expect(
              equal(live.configBytes, original.configBytes),
              "Another actor changed the USB config",
            ).toBe(true);
          expect(
            equal((await client.getConfig()).configBytes, original.configBytes),
          ).toBe(true);
          console.log("USB_PROGRAM_RESTORED", true);
        }
        if (tx) {
          await tx.rollback();
          tx.dispose();
          const restored = await peer.getConfig();
          expect(
            equal(
              restored.configBytes,
              new Uint8Array(
                readFileSync("/private/tmp/distributed47-e2e-can-original.cbor"),
              ),
            ),
          ).toBe(true);
          console.log("CAN_PROGRAM_RESTORED", true);
        }
        for (const profileId of newHostProfiles)
          await client.removeDeviceProfile({
            idBytes: new TextEncoder().encode(profileId),
            version: 1,
          });
        for (const profileId of newRemoteProfiles)
          await peer.removeDeviceProfile({
            idBytes: new TextEncoder().encode(profileId),
            version: 1,
          });
      } finally {
        unsubscribe();
        peer.dispose();
        client.dispose();
        transport.dispose();
        socket.close();
      }
    }
  },
  90000,
);
