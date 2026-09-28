/** `enum spaghetti_update_state`, `firmware/backbone/include/spaghetti/update.h:25-33` — sequential 0..6. */
export enum UpdateState {
  IDLE = 0,
  ARMED = 1,
  RECEIVING = 2,
  VERIFYING = 3,
  PENDING_REBOOT = 4,
  TRIAL_BOOT = 5,
  ERROR = 6,
}

const UPDATE_STATE_LABELS: Record<number, string> = {
  [UpdateState.IDLE]: "IDLE",
  [UpdateState.ARMED]: "ARMED",
  [UpdateState.RECEIVING]: "RECEIVING",
  [UpdateState.VERIFYING]: "VERIFYING",
  [UpdateState.PENDING_REBOOT]: "PENDING_REBOOT",
  [UpdateState.TRIAL_BOOT]: "TRIAL_BOOT",
  [UpdateState.ERROR]: "ERROR",
};

export function updateStateLabel(state: number): string {
  return UPDATE_STATE_LABELS[state] ?? `UNKNOWN(${state})`;
}

export type ArmEligibility = { readonly canArm: true } | { readonly canArm: false; readonly reason: string };

/**
 * Mirrors `spaghetti_update_arm()`'s real refusal conditions
 * (`update.h:70-71`): `-EPERM` while the running image is `TRIAL_BOOT` or
 * `ERROR` (an unconfirmed image must be confirmed or rolled back first,
 * never raced with a second OTA), `-EBUSY` while an adapter already owns an
 * upload or a candidate is `PENDING_REBOOT` (`RECEIVING`/`VERIFYING` count
 * as busy too, for the same reason). This is a client-side prediction of
 * what the firmware will do, not a substitute for it — the real refusal
 * still happens firmware-side when `OPEN_WIFI_UPDATE`/BLE update is
 * actually called.
 */
export function checkArmEligibility(state: UpdateState): ArmEligibility {
  if (state === UpdateState.TRIAL_BOOT || state === UpdateState.ERROR) {
    return { canArm: false, reason: `Core is in ${updateStateLabel(state)} — the running image must be confirmed or rolled back before a new OTA can start.` };
  }
  if (state === UpdateState.ARMED || state === UpdateState.RECEIVING || state === UpdateState.VERIFYING || state === UpdateState.PENDING_REBOOT) {
    return { canArm: false, reason: `Core is in ${updateStateLabel(state)} — an update is already in progress or awaiting reboot.` };
  }
  return { canArm: true };
}
