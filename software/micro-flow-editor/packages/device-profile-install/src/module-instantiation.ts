import type { ElectricalMode, ModuleEndpoint, ModuleNodeData } from "@spaghettilab/physical-composition-model";
import type { DeviceProfileSummary } from "@spaghettilab/protocol-sdk";

/**
 * `spaghetti_declarative_device_driver.type_id` (literally `"declarative-device"`,
 * `firmware/backbone/spaghetti_modules/declarative_device/declarative_device.c`) —
 * the one generic Module Driver every Device Profile instance runs under.
 * Never a per-sensor driver id: that is exactly the point of S061's
 * declarative acquisition plan.
 */
export const DECLARATIVE_DEVICE_DRIVER_TYPE_ID = "declarative-device";

export type ModuleInstantiationChoice = {
  readonly portId: number;
  readonly bayId: number;
  readonly railId: number;
  readonly electricalMode: ElectricalMode;
  readonly endpoint?: ModuleEndpoint;
  /** Instance calibration/configuration values — schema-driven per the profile, validated elsewhere (S042's `FormModel`), not by this function. */
  readonly properties?: Readonly<Record<string, unknown>>;
};

/**
 * Builds a `ModuleNodeData` (`@spaghettilab/physical-composition-model`,
 * S050) from a Core-confirmed installed profile and the Bay/rail/address a
 * human chose for this specific instance (S063 point 2: "permette di
 * istanziare il profilo come Module con address/Bay/label/calibrazione
 * specifici"). Label lives in `AuthoringMetadata`, same as every other
 * physical-composition entity — never a field here.
 *
 * Pure construction: this does not add anything to a graph. The caller adds
 * the result via the same generic `addGraphNodeCommand`
 * (`@spaghettilab/react-flow-adapter`) every other physical-composition node
 * uses — no new command type needed.
 */
export function instantiateModuleFromProfile(installed: DeviceProfileSummary, choice: ModuleInstantiationChoice): ModuleNodeData {
  return {
    kind: "module",
    driverTypeId: DECLARATIVE_DEVICE_DRIVER_TYPE_ID,
    profileId: installed.profileId,
    portId: choice.portId,
    bayId: choice.bayId,
    railId: choice.railId,
    endpoint: choice.endpoint,
    electricalMode: choice.electricalMode,
    properties: choice.properties ?? {},
  };
}
