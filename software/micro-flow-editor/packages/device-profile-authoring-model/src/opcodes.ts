/**
 * Bounded acquisition-plan opcode values, sourced directly from
 * `firmware/backbone/include/spaghetti/device_profile.h`
 * (`enum spaghetti_device_profile_opcode`), not guessed — this is a closed
 * vocabulary the firmware itself validates against: "unknown values are
 * rejected during validation. New opcodes require a firmware Capability
 * Pack; install never extends this set." (S061 point 2: "editor funzionale
 * delle istruzioni catalogate").
 */
export const DeviceProfileOpcode = {
  I2C_WRITE: 1,
  I2C_READ: 2,
  I2C_WRITE_READ: 3,
  SPI_TRANSCEIVE: 4,
  UART_WRITE: 5,
  UART_READ_UNTIL: 6,
  GPIO_GET: 7,
  GPIO_SET: 8,
  ADC_READ: 9,
  DELAY_BOUNDED: 10,
  WAIT_FIELD_MASK: 11,
  LOAD_CONST: 12,
  COPY_BYTES: 13,
  CONCAT: 14,
  BYTE_SWAP: 15,
  MASK: 16,
  SHIFT: 17,
  SIGN_EXTEND: 18,
  CRC8: 19,
  CRC16: 20,
  EMIT_FIELD: 21,
  EMIT_RECORD: 22,
  W1_WRITE_READ: 23,
  UART_READ: 24,
  WAIT_GPIO: 25,
} as const;
