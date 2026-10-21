import { expect, it } from "vitest";
import type { CoreBindingId, CoreBindingRecord, ProjectV1 } from "@spaghettilab/domain";
import { replaceUsbBackbone, replacementUsbBinding } from "../replace-usb-backbone.js";
function fixture(duplicate = false): ProjectV1 {
  return { coreBindings: [{ bindingId: "old", expectedDeviceId: "v1", connectionProfileId: "usb-old" }, ...(duplicate ? [{ bindingId: "new", expectedDeviceId: "v2", connectionProfileId: "usb-new" }] : [])],
    deviceGraphs: [{ layer: "device-processing", nodes: [{ id: "sensor" }], edges: [{ id: "wire" }] }, ...(duplicate ? [{ layer: "device-processing", nodes: [], edges: [] }] : [])],
    physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }, ...(duplicate ? [{ layer: "physical-composition", nodes: [], edges: [] }] : [])],
    authoringMetadata: { pins: { comment: JSON.stringify({ drafts: { "old:v1": { modes: [1,0,0,0] } }, module: { boardKey: "old:v1" } }) }, note: { comment: "Keep v1 label" } },
  } as unknown as ProjectV1;
}
const offline = new Set(["old" as CoreBindingId]);
const replacement = { bindingId: "old", expectedDeviceId: "v2", connectionProfileId: "usb-new" } as CoreBindingRecord;
it("reuses the disconnected board and preserves its graph and wiring", () => {
 const project=fixture();
 expect(replacementUsbBinding(project,"v2",offline)?.bindingId).toBe("old");
 const next=replaceUsbBackbone(project,replacement.bindingId,replacement);
 expect(next.coreBindings).toEqual([replacement]);
 expect(next.deviceGraphs[0]).toBe(project.deviceGraphs[0]);
 expect(JSON.parse(next.authoringMetadata.pins!.comment!)).toEqual({drafts:{"old:v2":{modes:[1,0,0,0]}},module:{boardKey:"old:v2"}});
 expect(next.authoringMetadata.note).toBe(project.authoringMetadata.note);
});
it("removes only an empty duplicate and keeps graph arrays aligned", () => {
 const project=fixture(true);
 expect(replacementUsbBinding(project,"v2",offline)?.bindingId).toBe("old");
 const next=replaceUsbBackbone(project,replacement.bindingId,replacement);
 expect(next.coreBindings).toHaveLength(1);
 expect(next.deviceGraphs).toEqual([project.deviceGraphs[0]]);
 expect(next.physicalGraphs).toEqual([project.physicalGraphs[0]]);
});
it("never replaces a live board or merges two authored programs", () => {
 expect(replacementUsbBinding(fixture(),"v2",new Set())).toBeUndefined();
 const project=fixture(true);const two={...project,deviceGraphs:[project.deviceGraphs[0]!,project.deviceGraphs[0]!]};
 expect(replacementUsbBinding(two,"v2",offline)).toBeUndefined();
 expect(()=>replaceUsbBackbone(two,replacement.bindingId,replacement)).toThrow("altro programma");
});
it("does not guess which offline board to replace", () => {
 expect(replacementUsbBinding(fixture(true),"third",new Set(["old","new"] as CoreBindingId[]))).toBeUndefined();
});

it("changing the USB master within the same CAN cluster preserves physical board assignments", () => {
 const project = fixture();
 const next = replaceUsbBackbone(project, replacement.bindingId, replacement, true);
 expect(next.coreBindings[0]?.expectedDeviceId).toBe("v2");
 expect(next.authoringMetadata).toBe(project.authoringMetadata);
 expect(next.deviceGraphs[0]).toBe(project.deviceGraphs[0]);
});
