import type { ProjectV1 } from "@spaghettilab/domain";
import { compileConfig, type CanonicalConfig } from "@spaghettilab/config-compiler";
import { diffConfigs, isConfigDiffEmpty } from "@spaghettilab/config-deployment";
import { prepareDistributedDeployment } from "./distributed-deployment-plan.js";
import type { GetStatusResponse } from "@spaghettilab/protocol-sdk";
import { oneShotDeploymentInput } from "./one-shot-deployment.js";

/** Compare executable configuration, not canvas positions or trigger presence alone. */
export function deploymentIsCurrent(project: ProjectV1, bindingId: string, live: CanonicalConfig, status?: GetStatusResponse): boolean {
  try {
    const index = project.coreBindings.findIndex(binding => binding.bindingId === bindingId);
    if (index < 0) return false;
    const plan = prepareDistributedDeployment(project, bindingId, {
      physicalGraph: project.physicalGraphs[index] ?? { layer: "physical-composition", nodes: [], edges: [] },
      processingGraph: project.deviceGraphs[index] ?? { layer: "device-processing", nodes: [], edges: [] },
      mqtt: live.mqtt, connectivity: live.connectivity, energy: live.energy,
    }, status);
    const completion = plan.profiles.filter(profile => profile.profileId.startsWith("flow.gpio-state.") ||
      profile.sampleOps.some(op => ["DS18B20_READ", "DHT22_READ", "STEPPER", "RGB_PROGRAM"].includes(op.op))).map(profile => profile.profileId);
    // Stop changes timer enablement, not the authored program. Accept either
    // deployed execution mode while still comparing intervals and all wiring.
    return [plan.input, oneShotDeploymentInput(plan.input, completion)].some(input => {
      const compiled = compileConfig(input, plan.options);
      return compiled.ok && isConfigDiffEmpty(diffConfigs(live, compiled.value));
    });
  } catch { return false; }
}

export const manualDeploymentIsCurrent = deploymentIsCurrent;
