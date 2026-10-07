import { describe, expect, it } from "vitest";
import { createEmptyProject, projectId, coreBindingId } from "@spaghettilab/domain";
import { compileConfig } from "@spaghettilab/config-compiler";
import { addConfirmedPinModules, physicalPinsForBinding } from "../physical-pin-bindings.js";
import { PHYSICAL_META_KEY } from "../backbone-physical.js";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";

function validProjectId() { const result = projectId("00000000-0000-4000-8000-000000000001"); if (!result.ok) throw new Error("id"); return result.value; }

describe("confirmed physical pins", () => {
  it("exposes confirmed pins and compiles a real input-to-output connection", () => {
    const result = coreBindingId("00000000-0000-4000-8000-000000000002"); if (!result.ok) throw new Error("id"); const bindingId = result.value;
    const key = `${bindingId}:device`;
    const draft = {name:"Custom module",modes:[17,2,12,0],i2cSpeed:0,applied:true,local:true,backendPortId:0};
    const project = {...createEmptyProject(validProjectId(),"Pins"),coreBindings:[{bindingId,expectedDeviceId:"device",connectionProfileId:"usb"}],authoringMetadata:{[PHYSICAL_META_KEY]:{comment:JSON.stringify({drafts:{[key]:draft},catalog:[]})}}};
    const confirmed = addConfirmedPinModules(project,bindingId,key,draft);
    const pins = physicalPinsForBinding(confirmed,bindingId);
    expect(pins.map(pin => pin.entryId)).toEqual(["native.physical_gpio_input","native.physical_gpio_out","native.physical_pwm_out"]);
    expect(confirmed.physicalGraphs[0]?.nodes).toHaveLength(1);
    const compiled = compileConfig({physicalGraph:confirmed.physicalGraphs[0]!,processingGraph:{layer:"device-processing",nodes:[{layer:"device-processing",id:"input",data:{kind:"event-source",moduleNodeId:pins[0]!.moduleNodeId}},{layer:"device-processing",id:"output",data:{kind:"block",blockTypeId:"physical_gpio_out",properties:{"1":0n,"2":1n}}}],edges:[{layer:"device-processing",id:"wire",source:"input",target:"output",sourceHandle:"1",targetHandle:"0"}]},mqtt:DISABLED_MQTT,energy:DEFAULT_ENERGY,connectivity:0});
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.value.modules[0]?.typeId).toBe("digital_input_trigger");
      expect(compiled.value.blocks[0]?.typeId).toBe("physical_gpio_out");
      expect(compiled.value.edges[0]?.sourcePortOrField).toBe(1);
    }
    const pending = {...project,authoringMetadata:{[PHYSICAL_META_KEY]:{comment:JSON.stringify({drafts:{[key]:{...draft,applied:false}},catalog:[]})}}};
    expect(physicalPinsForBinding(pending,bindingId)).toEqual([]);
  });
  it("keeps other boards separate and removes input drivers after a mode change", () => {
    const result = coreBindingId("00000000-0000-4000-8000-000000000002"); if (!result.ok) throw new Error("id"); const bindingId = result.value;
    const project = {...createEmptyProject(validProjectId(),"Pins"),coreBindings:[{bindingId,expectedDeviceId:"device",connectionProfileId:"usb"}]};
    const draft = {name:"Custom",modes:[1,0,0,0],i2cSpeed:0,local:true};
    const initial = addConfirmedPinModules(project,bindingId,`${bindingId}:device`,draft);
    expect(initial.physicalGraphs[0]?.nodes).toHaveLength(1);
    expect(addConfirmedPinModules(initial,bindingId,`${bindingId}:device`,{...draft,modes:[2,0,0,0]}).physicalGraphs[0]?.nodes).toHaveLength(0);
    expect(addConfirmedPinModules(project,bindingId,`${bindingId}:remote`,{...draft,local:false})).toEqual(project);
  });
});
