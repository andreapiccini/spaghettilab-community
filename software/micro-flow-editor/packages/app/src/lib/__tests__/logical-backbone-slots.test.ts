import {
  encodePhysicalSettings,
  DEFAULT_PHYSICAL_SETTINGS,
} from "@spaghettilab/protocol-sdk";
import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import type { GetStatusResponse } from "@spaghettilab/protocol-sdk";
import {
  moduleBackboneLabels,
  resolveLogicalBackbones,
} from "../logical-backbone-slots.js";
import { PHYSICAL_META_KEY, parsePhysicalProject } from "../backbone-physical.js";
import { BACKBONE_SENSOR_MODULES_META_KEY } from "../backbone-sensor-modules.js";
function project(slot: number): ProjectV1 {
  return {
    coreBindings: [{ bindingId: "cluster", expectedDeviceId: "old-usb" }],
    physicalGraphs: [],
    deviceGraphs: [
      {
        layer: "device-processing",
        nodes: [
          {
            id: "sensor-block",
            layer: "device-processing",
            data: {
              kind: "block",
              blockTypeId: "backbone_sensor",
              properties: { backboneSensorModuleId: "sensor" },
            },
          },
        ],
        edges: [],
      },
    ],
    authoringMetadata: {
      [PHYSICAL_META_KEY]: {
        comment: JSON.stringify({
          drafts: Object.fromEntries(
            [1, 2, 3].map((index) => [
              `cluster:old-${index === 1 ? "usb" : index}`,
              {
                name: "Function",
                modes: [index, 0, 0, 0],
                i2cSpeed: 0,
                local: index === 1,
                nodeId: 100 + index,
              },
            ]),
          ),
        }),
      },
      [BACKBONE_SENSOR_MODULES_META_KEY]: {
        comment: JSON.stringify({
          version: 1,
          byBinding: {
            cluster: [
              {
                id: "sensor",
                recipe: {},
                label: "Temperatura",
                gpioAssignments: {
                  boardKey: `cluster:old-${slot === 1 ? "usb" : slot}`,
                  channels: { DATA: 0 },
                },
              },
            ],
          },
        }),
      },
    },
  } as unknown as ProjectV1;
}
const status = {
  deviceId: Uint8Array.from([0x90, 0x70, 0x69, 0, 0, 9, ...Array(26).fill(0)]),
  chainPeers: [
    { nodeId: 9, local: true, mac: new Uint8Array(6), flags: 128 },
    { nodeId: 10, local: false, mac: new Uint8Array(6), flags: 0 },
  ],
} as unknown as GetStatusResponse;
it("replaces board identities by position without rewriting the canvas or losing pin settings", () => {
  const source = project(2);
  const result = resolveLogicalBackbones(source, "cluster", status);
  const drafts = parsePhysicalProject(
    result.project.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  ).drafts;
  expect(drafts["cluster:old-usb"]).toMatchObject({ nodeId: 9, local: true });
  expect(drafts["cluster:old-2"]).toMatchObject({
    nodeId: 10,
    local: false,
    modes: [2, 0, 0, 0],
  });
  expect(result.requests).toMatchObject([
    { nodeId: 10, modes: new Uint8Array([2, 0, 0, 0]) },
  ]);
  expect(result.project.deviceGraphs).toBe(source.deviceGraphs);
  expect(source.coreBindings[0]?.expectedDeviceId).toBe("old-usb");
});
it("stops before deployment when a used third position is missing and names its module", () => {
  expect(() => resolveLogicalBackbones(project(3), "cluster", status)).toThrow(
    /Backbone 3.*Temperatura/,
  );
});
it("does not require unused positions and never moves a module from position three into position two", () => {
  expect(() => resolveLogicalBackbones(project(1), "cluster", status)).not.toThrow();
  const one = { ...status, chainPeers: status.chainPeers!.slice(0, 1) };
  expect(() => resolveLogicalBackbones(project(2), "cluster", one)).toThrow(
    /Backbone 2/,
  );
});
it("reserves the USB position when only a remote board has authored settings", () => {
  const source = project(2);
  const physical = parsePhysicalProject(
    source.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  );
  const reduced = {
    ...source,
    authoringMetadata: {
      ...source.authoringMetadata,
      [PHYSICAL_META_KEY]: {
        comment: JSON.stringify({
          ...physical,
          drafts: { "cluster:old-2": physical.drafts["cluster:old-2"] },
        }),
      },
    },
  };
  expect(resolveLogicalBackbones(reduced, "cluster", status).requests[0]?.nodeId).toBe(
    10,
  );
});

it("preserves an explicit third position even when the second has no saved settings", () => {
  const source = project(2);
  const physical = parsePhysicalProject(
    source.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  );
  const revised = {
    ...source,
    authoringMetadata: {
      ...source.authoringMetadata,
      [PHYSICAL_META_KEY]: {
        comment: JSON.stringify({
          drafts: {
            "cluster:old-2": { ...physical.drafts["cluster:old-2"], logicalSlot: 3 },
          },
        }),
      },
    },
  };
  expect(() => resolveLogicalBackbones(revised, "cluster", status)).toThrow(
    /Backbone 3.*Temperatura/,
  );
});

it("distinguishes identical modules by their logical Backbone position", () => {
  const source = project(2);
  const stored = JSON.parse(
    source.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]!.comment!,
  );
  const sensor = stored.byBinding.cluster[0];
  stored.byBinding.cluster.push({
    ...sensor,
    id: "second",
    gpioAssignments: { ...sensor.gpioAssignments, boardKey: "cluster:old-usb" },
  });
  const revised = {
    ...source,
    authoringMetadata: {
      ...source.authoringMetadata,
      [BACKBONE_SENSOR_MODULES_META_KEY]: { comment: JSON.stringify(stored) },
    },
  };
  const labels = moduleBackboneLabels(revised, "cluster", status);
  expect(labels.get("sensor")).toBe("Backbone 2");
  expect(labels.get("second")).toBe("Backbone 1");
});

it("expands legacy four-pin settings to the eight pins reported by a replacement V2", () => {
  const descriptor = new Uint8Array(37);
  descriptor.set([3, 1, 1, 2, 0, 255, 0, 0, 0, 0, 0, 0, 1]);
  descriptor.set(encodePhysicalSettings(DEFAULT_PHYSICAL_SETTINGS), 13);
  const live = {
    ...status,
    chainPeers: status.chainPeers!.map((peer) => ({ ...peer, physical: descriptor })),
  };
  const result = resolveLogicalBackbones(project(2), "cluster", live);
  expect(Array.from(result.requests[0]!.modes)).toEqual([2, 0, 0, 0, 0, 0, 0, 0]);
  expect(
    parsePhysicalProject(result.project.authoringMetadata[PHYSICAL_META_KEY]?.comment)
      .drafts["cluster:old-2"],
  ).toMatchObject({ variant: "v2", modes: [2, 0, 0, 0, 0, 0, 0, 0] });
});

it("does not require a disconnected Backbone after its last canvas block is removed", () => {
  const source = project(2);
  const withoutBlock = {
    ...source,
    deviceGraphs: [{ ...source.deviceGraphs[0]!, nodes: [], edges: [] }],
  };
  const usbOnly = {
    ...status,
    chainPeers: status.chainPeers!.filter((peer) => peer.local),
  };
  const result = resolveLogicalBackbones(withoutBlock, "cluster", usbOnly);
  expect(result.requests).toEqual([]);
  expect(() => resolveLogicalBackbones(source, "cluster", usbOnly)).toThrow(
    /Backbone 2/,
  );
});
