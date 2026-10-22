import type { DeviceProfileDraft } from "@spaghettilab/device-profile-authoring-model";
import { PortTransport } from "@spaghettilab/device-profile-authoring-model";
import { stableDriverHash } from "./driver-runtime-profile.js";
export const MANUAL_TRIGGER_TYPE = "ui.manual_trigger";
export const MANUAL_TRIGGER_ID = "appblocks.manual_trigger";
export function manualTriggerProfileId(nodeId: string): string {
  return `flow.trigger.${stableDriverHash(nodeId)}`;
}
/** Two commands publish LOW/HIGH records. No pin, sleep or busy loop is involved. */
export function manualTriggerProfile(nodeId: string): DeviceProfileDraft {
  const profileId = manualTriggerProfileId(nodeId);
  return {
    profileId,
    version: 1,
    transport: PortTransport.LOGICAL,
    requiredCapabilities: 0,
    maxTotalTimeMs: 1,
    maxTransactions: 0,
    maxBytes: 0,
    initOps: [],
    safeStopOps: [],
    sampleOps: [0, 1].flatMap((value) => [
      { op: "LOAD_CONST" as const, dst: 0, length: 1, low: value, high: 0 },
      {
        op: "EMIT_FIELD" as const,
        src: 0,
        fieldId: 1,
        width: 1,
        byteOrder: "le" as const,
        signExtend: false,
        multiplier: 0,
      },
      { op: "EMIT_RECORD" as const },
    ]),
    actions: [
      { id: 1, first: 0, count: 3 },
      { id: 2, first: 3, count: 3 },
    ],
    sampleSchemaId: `${profileId}.s`,
    sampleSchemaVersion: 1,
    sampleFields: [{ fieldId: 1, type: "uint64", name: "trigger", unit: "" }],
  };
}
/** Always return to LOW; a second press must produce a new rising edge. */
export async function sendManualTrigger(
  command: (id: number) => Promise<unknown>,
): Promise<void> {
  await command(1);
  try {
    await command(2);
  } finally {
    await command(1);
  }
}

/** Timers own scheduled buttons during Run; standalone buttons remain manual. */
export function manualTriggerBlocked(mode: string, scheduled: boolean): boolean {
  return mode === "busy" || (mode === "continuous" && scheduled);
}
