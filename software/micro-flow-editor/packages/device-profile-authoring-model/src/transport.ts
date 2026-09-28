/**
 * Sourced from `firmware/backbone/include/spaghetti/port.h`,
 * `enum spaghetti_port_transport` — the electrical family a Device Profile
 * requires a Port to be running as. Distinct from
 * `@spaghettilab/physical-composition-model`'s caller-supplied `TransportOf`
 * classifier (which exists precisely because *that* level of the model —
 * the generic Module Driver catalog entry — has no transport field): here,
 * at the Device Profile level, transport is real, declared data.
 */
export const PortTransport = {
  I2C: 0,
  SPI: 1,
  UART: 2,
  GPIO: 3,
  ADC: 4,
  W1: 5,
} as const;

/**
 * Sourced from `port.h`'s `enum spaghetti_port_capability` — a bitmask, since
 * a Port can expose more than one possible function even though only one
 * electrical family is active at runtime. `requiredCapabilities` on a
 * `DeviceProfileDraft` is the OR of whichever of these the profile needs.
 */
export const PortCapability = {
  I2C: 1 << 0,
  SPI: 1 << 1,
  UART: 1 << 2,
  DIGITAL_INPUT: 1 << 3,
  DIGITAL_OUTPUT: 1 << 4,
  ADC: 1 << 5,
  W1: 1 << 6,
} as const;
