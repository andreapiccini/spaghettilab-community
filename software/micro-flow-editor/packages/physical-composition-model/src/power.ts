/**
 * `RailEntry.assurance` (`@spaghettilab/catalog-model`) is a raw Core-reported
 * number — S041 deliberately never coerces it. These names resolve that
 * number for validation purposes only, sourced directly from the firmware's
 * own definition (`firmware/backbone/include/spaghetti/power.h`,
 * `enum spaghetti_power_assurance`) rather than guessed: `UNMANAGED` (0) is a
 * passive/jumper rail firmware cannot verify, `SWITCHED` (1) it can
 * enable/disable, `SWITCHED_AND_MEASURED` (2) adds measurement. Nothing
 * upstream of this file is changed — `catalog-model`'s pass-through contract
 * still holds; this is purely a local interpretation at the point of use.
 */
export const RailAssurance = {
  UNMANAGED: 0,
  SWITCHED: 1,
  SWITCHED_AND_MEASURED: 2,
} as const;

/**
 * `FunctionBayEntry.admission` resolved the same way, from
 * `enum spaghetti_power_admission_state` in the same firmware header.
 */
export const PowerAdmission = {
  NOT_REQUIRED: 0,
  UNVERIFIED: 1,
  ENFORCED: 2,
} as const;

/**
 * A rail firmware cannot verify (`UNMANAGED`) is exactly the case
 * `REACT_FLOW_ARCHITECTURE.md`/S050 call "passive power": placing a Module on
 * it must stay possible, but requires an explicit human acknowledgement
 * before deploy rather than a silent `ENFORCED`-looking accept.
 */
export function requiresPowerAcknowledgement(railAssurance: number): boolean {
  return railAssurance === RailAssurance.UNMANAGED;
}
