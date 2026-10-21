import {
  domainError,
  err,
  ok,
  type DomainError,
  type Result,
} from "@spaghettilab/domain";
import { DeviceProfileOpcode } from "./opcodes.js";
import { DeviceProfileErrorCode } from "./errors.js";
import type { Instruction } from "./instruction.js";
import { MAX_TEMP_SLOTS } from "./instruction.js";
import type { DeviceProfileDraft } from "./profile.js";
import { PROFILE_ID_MAX_LENGTH, SCHEMA_ID_MAX_LENGTH } from "./profile.js";
import { FIELD_NAME_MAX_LENGTH, UNIT_NAME_MAX_LENGTH } from "./sample-field.js";

/**
 * Mirrors `struct spaghetti_device_profile_budget` (`device_profile.h`) —
 * the same four counters `accumulate_op_budget`
 * (`firmware/backbone/subsys/device_profiles/device_profile.c`) computes.
 */
export type DeviceProfileBudget = {
  readonly totalTimeMs: number;
  readonly transactions: number;
  readonly bytes: number;
  readonly operations: number;
};

function failure(
  code: string,
  path: string[],
  target: string,
  remediation: string,
): DomainError {
  return domainError({ code, path: ["device-profile", ...path], target, remediation });
}

/** Every temp slot an instruction reads or writes — for bounds checking only; not every opcode that touches a slot is checked by the firmware's own validator (e.g. `GPIO_SET` reads no slot at all), but any slot reference this package emits must still be in range. */
function tempSlots(instruction: Instruction): number[] {
  switch (instruction.op) {
    case "GPIO_SET_VALUE":
    case "MESSAGE_PATCH":
      return [instruction.src];
    case "MESSAGE_LOAD":
    case "I2C_MESSAGE_WRITE":
      return [];
    case "I2C_WRITE":
    case "UART_WRITE":
      return [instruction.src];
    case "I2C_READ":
    case "GPIO_GET":
    case "ADC_READ":
    case "UART_READ_UNTIL":
    case "UART_READ":
      return [instruction.dst];
    case "I2C_WRITE_READ":
    case "SPI_TRANSCEIVE":
    case "W1_WRITE_READ":
    case "SCALE_PACK":
    case "COPY_BYTES":
    case "BYTE_SWAP":
    case "MASK":
    case "SHIFT":
    case "SIGN_EXTEND":
    case "CRC8":
    case "CRC16":
      return [instruction.src, instruction.dst];
    case "WAIT_FIELD_MASK":
      return [instruction.dst, instruction.src];
    case "WAIT_GPIO":
    case "LOAD_VALUE":
    case "LOAD_ARGUMENT":
    case "LOAD_CONST":
      return [instruction.dst];
    case "CONCAT":
      return [instruction.srcA, instruction.srcB, instruction.dst];
    case "EMIT_FIELD":
      return [instruction.src];
    case "EMIT_DECIMAL":
      return [instruction.src];
    case "DS18B20_READ":
      return [instruction.dst];
    case "PWM_SET": return [instruction.src];
    case "DS18B20_SETUP":
      return [];
    case "DHT22_READ":
      return [instruction.dst, instruction.humidityDst];
    case "DHT22_POWER":
    case "RGB_PROGRAM":
      return [];
    case "STEPPER":
      return instruction.command === 2 ? [instruction.src] : [];
    case "GPIO_SET":
    case "GPIO_PULSE":
    case "DELAY_BOUNDED":
    case "EMIT_RECORD":
      return [];
  }
}

/** "Count of Port bus operations including wait polls" per `spaghetti_device_profile_budget`'s own doc comment — mirrors `accumulate_op_budget` exactly. */
function transactionsFor(instruction: Instruction): number {
  switch (instruction.op) {
    case "DHT22_READ":
    case "DHT22_POWER":
      return 2;
    case "DS18B20_READ":
    case "DS18B20_SETUP":
      return 1;
    case "RGB_PROGRAM":
      return 3;
    case "STEPPER":
      return 4;
    case "GPIO_PULSE":
      return 2;
    case "I2C_MESSAGE_WRITE":
    case "I2C_WRITE":
    case "I2C_READ":
    case "I2C_WRITE_READ":
    case "SPI_TRANSCEIVE":
    case "UART_WRITE":
    case "UART_READ_UNTIL":
    case "UART_READ":
    case "PWM_SET":
    case "GPIO_GET":
    case "GPIO_SET":
    case "GPIO_SET_VALUE":
    case "ADC_READ":
      return 1;
    case "WAIT_FIELD_MASK":
    case "WAIT_GPIO":
      return instruction.attempts;
    case "W1_WRITE_READ":
      return 1;
    default:
      return 0;
  }
}

/** Mirrors `accumulate_op_budget`'s `bytes` computation exactly, opcode by opcode — no simulation of temp-slot contents, just the same fixed formula the firmware itself uses. */
function bytesFor(instruction: Instruction): number {
  switch (instruction.op) {
    case "I2C_MESSAGE_WRITE":
    case "I2C_WRITE":
    case "I2C_READ":
    case "SPI_TRANSCEIVE":
    case "UART_WRITE":
      return instruction.length;
    case "I2C_WRITE_READ":
    case "W1_WRITE_READ":
      return (
        instruction.readLength +
        (instruction.writeLength !== 0 ? instruction.writeLength : 1)
      );
    case "UART_READ_UNTIL":
      return instruction.maxLength;
    case "UART_READ":
      return instruction.length;
    case "WAIT_FIELD_MASK":
      return instruction.attempts * 2;
    default:
      return 0;
  }
}

function timeFor(instruction: Instruction): number {
  switch (instruction.op) {
    case "DHT22_READ":
      return instruction.model === "dht11" ? 32 : 12;
    case "DS18B20_READ":
      return 20;
    case "I2C_MESSAGE_WRITE":
    case "I2C_WRITE":
    case "I2C_READ":
    case "SPI_TRANSCEIVE":
    case "UART_WRITE":
    case "UART_READ_UNTIL":
    case "UART_READ":
      return instruction.timeoutMs;
    case "I2C_WRITE_READ":
    case "W1_WRITE_READ":
      return Math.min(instruction.timeoutMs, 0xffff);
    case "ADC_READ":
      return instruction.timeoutMs;
    case "DELAY_BOUNDED":
      return instruction.milliseconds;
    case "WAIT_FIELD_MASK":
    case "WAIT_GPIO":
      return instruction.attempts * instruction.intervalMs;
    default:
      return 0;
  }
}

/** Computes the same four counters as `spaghetti_device_profile_validate`'s `out_budget`, via the same fixed per-opcode formula `accumulate_op_budget` uses — never an arbitrary one (S061 point 3). */
export function computeBudget(draft: DeviceProfileDraft): DeviceProfileBudget {
  const allOps = [...draft.initOps, ...draft.sampleOps, ...draft.safeStopOps];
  let totalTimeMs = 0;
  let transactions = 0;
  let bytes = 0;
  for (const instruction of allOps) {
    totalTimeMs += timeFor(instruction);
    transactions += transactionsFor(instruction);
    bytes += bytesFor(instruction);
  }
  return { totalTimeMs, transactions, bytes, operations: allOps.length };
}

/** Opcode-specific structural checks `accumulate_op_budget` performs beyond temp-slot bounds (e.g. a required length must be nonzero, `LOAD_CONST`'s length must be 1-8, `BYTE_SWAP`'s width must be 2 or 4 — the last already enforced at the type level by `ByteSwapInstruction.width`). Returns `undefined` when the instruction has nothing extra to check. */
function structuralError(
  instruction: Instruction,
): { target: string; remediation: string } | undefined {
  switch (instruction.op) {
    case "PWM_SET": return !Number.isInteger(instruction.channel) || instruction.channel<0 || instruction.channel>3 || !Number.isInteger(instruction.frequencyHz) || instruction.frequencyHz<0 || instruction.frequencyHz>1000000 ? { target: "PWM_SET", remediation: "PWM requires a channel 0..3 and frequency 0..1000000 Hz" } : undefined;
    case "DS18B20_SETUP":
    case "DS18B20_READ":
      return !Number.isInteger(instruction.channel) ||
        instruction.channel < 0 ||
        instruction.channel > 3 ||
        (instruction.op === "DS18B20_SETUP" &&
          instruction.externalPower === true &&
          instruction.powerChannel !== undefined) ||
        (instruction.op === "DS18B20_SETUP" &&
          instruction.powerChannel !== undefined &&
          (!Number.isInteger(instruction.powerChannel) ||
            instruction.powerChannel < 0 ||
            instruction.powerChannel > 3 ||
            instruction.powerChannel === instruction.channel))
        ? {
            target: instruction.op,
            remediation: "Select distinct DATA and power GPIOs",
          }
        : undefined;
    case "DHT22_POWER":
    case "DHT22_READ":
      return !Number.isInteger(instruction.dataChannel) ||
        !Number.isInteger(instruction.powerChannel) ||
        instruction.dataChannel < 0 ||
        instruction.dataChannel > 3 ||
        instruction.powerChannel < 0 ||
        instruction.powerChannel > 3 ||
        instruction.dataChannel === instruction.powerChannel ||
        (instruction.op === "DHT22_READ" && instruction.dst === instruction.humidityDst)
        ? {
            target: instruction.op,
            remediation:
              "DHT22 requires distinct DATA and power GPIOs and output slots",
          }
        : undefined;
    case "RGB_PROGRAM":
      return (instruction.nodeId !== undefined &&
        (!Number.isInteger(instruction.nodeId) ||
          instruction.nodeId < 1 ||
          instruction.nodeId > 0xffffff)) ||
        instruction.offset < 0 ||
        !Number.isInteger(instruction.offset) ||
        instruction.length < 6 ||
        instruction.length > 96 ||
        instruction.length % 6 ||
        !Number.isInteger(instruction.channels) ||
        instruction.channels < 0 ||
        instruction.channels > 63 ||
        new Set([
          instruction.channels & 3,
          (instruction.channels >> 2) & 3,
          (instruction.channels >> 4) & 3,
        ]).size !== 3
        ? { target: "RGB_PROGRAM", remediation: "Invalid RGB program or channels" }
        : undefined;
    case "STEPPER": {
      const channels = Array.from(
        { length: 4 },
        (_, i) => (instruction.channels >> (2 * i)) & 3,
      );
      return !Number.isInteger(instruction.command) ||
        instruction.command < 0 ||
        instruction.command > 2 ||
        !Number.isInteger(instruction.channels) ||
        instruction.channels < 0 ||
        instruction.channels > 255 ||
        new Set(channels).size !== 4 ||
        !Number.isInteger(instruction.intervalMs) ||
        instruction.intervalMs < 2 ||
        instruction.intervalMs > 100 ||
        !Number.isInteger(instruction.stepsPerRevolution) ||
        instruction.stepsPerRevolution < 8 ||
        instruction.stepsPerRevolution > 16384
        ? {
            target: "STEPPER",
            remediation:
              "Invalid stepper command, four unique channels, interval (2..100 ms) or steps/revolution (8..16384)",
          }
        : undefined;
    }
    case "GPIO_PULSE":
      return !Number.isInteger(instruction.channel) ||
        instruction.channel < 0 ||
        instruction.channel > 3 ||
        !Number.isInteger(instruction.milliseconds) ||
        instruction.milliseconds < 1 ||
        instruction.milliseconds > 60000
        ? {
            target: "GPIO_PULSE",
            remediation: "Invalid channel or pulse duration (1..60000 ms)",
          }
        : undefined;
    case "GPIO_GET":
    case "GPIO_SET":
    case "GPIO_SET_VALUE":
      return !Number.isInteger(instruction.channel ?? 0) ||
        (instruction.channel ?? 0) < 0 ||
        (instruction.channel ?? 0) > 3
        ? { target: "GPIO channel", remediation: "GPIO channel must be 0..3" }
        : undefined;
    case "I2C_READ":
    case "SPI_TRANSCEIVE":
    case "UART_READ":
    case "UART_READ_UNTIL":
      return instruction.op === "UART_READ_UNTIL"
        ? instruction.maxLength === 0
          ? { target: "maxLength", remediation: "maxLength must be greater than zero" }
          : undefined
        : instruction.length === 0
          ? { target: "length", remediation: "length must be greater than zero" }
          : instruction.op === "SPI_TRANSCEIVE" &&
              (instruction.mode < 0 || instruction.mode > 3)
            ? { target: "mode", remediation: "SPI_TRANSCEIVE mode must be 0-3" }
            : undefined;
    case "I2C_WRITE_READ":
    case "W1_WRITE_READ":
      return instruction.readLength === 0 && instruction.op === "I2C_WRITE_READ"
        ? { target: "readLength", remediation: "readLength must be greater than zero" }
        : undefined;
    case "SCALE_PACK":
      return instruction.flags > 7 ||
        instruction.width < 1 ||
        instruction.width > 8 ||
        instruction.divisor < 1
        ? { target: "SCALE_PACK", remediation: "Invalid scale or pack operands" }
        : undefined;
    case "LOAD_VALUE":
    case "LOAD_ARGUMENT":
      return instruction.argumentId < 1 ||
        instruction.argumentId > 8 ||
        instruction.length < 1 ||
        instruction.length > 8
        ? { target: "LOAD_ARGUMENT", remediation: "Argument ID and width must be 1..8" }
        : undefined;
    case "LOAD_CONST":
      return instruction.length < 1 || instruction.length > 8
        ? { target: "length", remediation: "LOAD_CONST length must be 1-8 bytes" }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Validates a `DeviceProfileDraft` the way the firmware's own
 * `spaghetti_device_profile_validate` would (temp-slot bounds, unbounded
 * `WAIT_FIELD_MASK`, per-opcode structural checks, schema/EMIT coherence,
 * declared budget), collecting every problem instead of stopping at the
 * first (matching `@spaghettilab/domain`'s `validateProjectV1` precedent).
 * Returns the computed `DeviceProfileBudget` on success, mirroring the
 * firmware function's own `out_budget` — written only when validation
 * passes.
 *
 * `maxOperationCount` is caller-supplied and optional: the firmware's own
 * `CONFIG_SPAGHETTI_MAX_PROFILE_OPERATIONS`/`..._ACQUISITION_OPERATIONS` are
 * Kconfig-tunable build settings, not wire data, so this package cannot know
 * them without being told.
 */
export function validateDeviceProfile(
  draft: DeviceProfileDraft,
  options?: { readonly maxOperationCount?: number },
): Result<DeviceProfileBudget, readonly DomainError[]> {
  const errors: DomainError[] = [];
  if (
    draft.messageData &&
    (draft.messageData.length > 3072 ||
      draft.messageData.some(
        (byte) => !Number.isInteger(byte) || byte < 0 || byte > 255,
      ))
  )
    errors.push(
      failure(
        DeviceProfileErrorCode.BYTE_BUDGET_EXCEEDED,
        ["messageData"],
        "bytes",
        "Message data must contain at most 3072 valid bytes",
      ),
    );

  if (draft.profileId.length === 0 || draft.profileId.length > PROFILE_ID_MAX_LENGTH) {
    errors.push(
      failure(
        DeviceProfileErrorCode.INVALID_PROFILE_ID,
        ["profileId"],
        draft.profileId,
        `profileId must be 1-${PROFILE_ID_MAX_LENGTH} bytes`,
      ),
    );
  }
  if (
    (draft.sampleFields.length > 0 || (draft.actions?.length ?? 0) > 0) &&
    (draft.sampleSchemaId.length === 0 ||
      draft.sampleSchemaId.length > SCHEMA_ID_MAX_LENGTH)
  ) {
    errors.push(
      failure(
        DeviceProfileErrorCode.INVALID_SCHEMA_ID,
        ["sampleSchemaId"],
        draft.sampleSchemaId,
        `sampleSchemaId must be 1-${SCHEMA_ID_MAX_LENGTH} bytes`,
      ),
    );
  }

  const plans: readonly [string, readonly Instruction[]][] = [
    ["initOps", draft.initOps],
    ["sampleOps", draft.sampleOps],
    ["safeStopOps", draft.safeStopOps],
  ];

  const emittedFieldIds = new Set<number>();
  for (const [planName, ops] of plans) {
    let messageLength = 0;
    ops.forEach((instruction, index) => {
      const path = [planName, String(index)];
      const opcode = DeviceProfileOpcode[instruction.op];
      if (
        draft.transport === 6 &&
        (opcode <= 9 || [11, 23, 24, 25, 31, 32, 33, 34, 35].includes(opcode))
      ) {
        errors.push(
          failure(
            DeviceProfileErrorCode.TEMP_SLOT_OUT_OF_RANGE,
            path,
            instruction.op,
            "Logical profiles cannot access physical pins or buses",
          ),
        );
      }
      let messageError = false;
      if (instruction.op === "RGB_PROGRAM") {
        messageError =
          instruction.offset + instruction.length > (draft.messageData?.length ?? 0) ||
          draft.transport !== 3;
      } else if (instruction.op === "MESSAGE_LOAD") {
        messageLength = instruction.length;
        messageError =
          !Number.isInteger(instruction.offset) ||
          instruction.offset < 0 ||
          !Number.isInteger(instruction.length) ||
          instruction.length < 1 ||
          instruction.length > 2048 ||
          instruction.offset + instruction.length > (draft.messageData?.length ?? 0);
      } else if (instruction.op === "MESSAGE_PATCH") {
        messageError =
          !Number.isInteger(instruction.offset) ||
          instruction.offset < 0 ||
          !Number.isInteger(instruction.length) ||
          instruction.length < 1 ||
          instruction.length > 32 ||
          instruction.offset + instruction.length > messageLength;
      } else if (instruction.op === "I2C_MESSAGE_WRITE") {
        messageError =
          draft.transport !== 0 ||
          !Number.isInteger(instruction.length) ||
          instruction.length < 1 ||
          instruction.length !== messageLength ||
          !Number.isInteger(instruction.timeoutMs) ||
          instruction.timeoutMs < 1 ||
          instruction.timeoutMs > 65535;
        messageLength = 0;
      }
      if (messageError)
        errors.push(
          failure(
            DeviceProfileErrorCode.TEMP_SLOT_OUT_OF_RANGE,
            path,
            instruction.op,
            "Invalid message range, transport, timeout or missing MESSAGE_LOAD",
          ),
        );

      for (const slot of tempSlots(instruction)) {
        if (slot < 0 || slot >= MAX_TEMP_SLOTS) {
          errors.push(
            failure(
              DeviceProfileErrorCode.TEMP_SLOT_OUT_OF_RANGE,
              path,
              String(slot),
              `temp slot must be 0-${MAX_TEMP_SLOTS - 1}`,
            ),
          );
        }
      }
      if (
        (instruction.op === "WAIT_FIELD_MASK" || instruction.op === "WAIT_GPIO") &&
        instruction.attempts <= 0
      ) {
        errors.push(
          failure(
            DeviceProfileErrorCode.UNBOUNDED_WAIT,
            path,
            "attempts",
            `${instruction.op}.attempts must be greater than zero — zero attempts is an unbounded wait`,
          ),
        );
      }
      const structural = structuralError(instruction);
      if (structural) {
        errors.push(
          failure(
            DeviceProfileErrorCode.TEMP_SLOT_OUT_OF_RANGE,
            path,
            structural.target,
            structural.remediation,
          ),
        );
      }
      if (instruction.op === "EMIT_FIELD" || instruction.op === "EMIT_DECIMAL") {
        emittedFieldIds.add(instruction.fieldId);
      }
    });
  }

  const seenFieldIds = new Set<number>();
  const seenFieldNames = new Set<string>();
  draft.sampleFields.forEach((field, index) => {
    const path = ["sampleFields", String(index)];
    if (seenFieldIds.has(field.fieldId)) {
      errors.push(
        failure(
          DeviceProfileErrorCode.DUPLICATE_FIELD_ID,
          path,
          String(field.fieldId),
          "each sampleField.fieldId must be unique",
        ),
      );
    }
    seenFieldIds.add(field.fieldId);
    if (seenFieldNames.has(field.name)) {
      errors.push(
        failure(
          DeviceProfileErrorCode.DUPLICATE_FIELD_NAME,
          path,
          field.name,
          "each sampleField.name must be unique",
        ),
      );
    }
    seenFieldNames.add(field.name);
    if (field.name.length === 0 || field.name.length > FIELD_NAME_MAX_LENGTH) {
      errors.push(
        failure(
          DeviceProfileErrorCode.FIELD_NAME_TOO_LONG,
          path,
          field.name,
          `sampleField.name must be 1-${FIELD_NAME_MAX_LENGTH} bytes`,
        ),
      );
    }
    if (field.unit !== undefined && field.unit.length > UNIT_NAME_MAX_LENGTH) {
      errors.push(
        failure(
          DeviceProfileErrorCode.UNIT_NAME_TOO_LONG,
          path,
          field.unit,
          `sampleField.unit must be at most ${UNIT_NAME_MAX_LENGTH} bytes`,
        ),
      );
    }
    if (
      !emittedFieldIds.has(field.fieldId) &&
      !(
        ((field.fieldId === 65531 || field.fieldId === 65532) &&
          field.type === "uint64" &&
          draft.sampleOps.some((op) => op.op === "RGB_PROGRAM")) ||
        (field.fieldId === 65534 &&
          field.type === "uint64" &&
          field.name === "movement_completed" &&
          draft.sampleOps.some((op) => op.op === "STEPPER"))
      )
    ) {
      errors.push(
        failure(
          DeviceProfileErrorCode.UNEMITTED_FIELD,
          path,
          String(field.fieldId),
          "declared sampleField is never produced by an EMIT_FIELD in sampleOps",
        ),
      );
    }
  });

  for (const fieldId of emittedFieldIds) {
    if (!seenFieldIds.has(fieldId)) {
      errors.push(
        failure(
          DeviceProfileErrorCode.UNKNOWN_EMITTED_FIELD,
          ["sampleOps"],
          String(fieldId),
          "EMIT_FIELD references a fieldId not declared in sampleFields",
        ),
      );
    }
  }

  if (draft.actions) {
    const ids = new Set<number>();
    let next = 0;
    let valid = draft.actions.length > 0 && draft.actions.length <= 8;
    for (const action of draft.actions) {
      valid &&=
        Number.isInteger(action.id) &&
        action.id >= 1 &&
        action.id <= 8 &&
        !ids.has(action.id) &&
        action.first === next &&
        Number.isInteger(action.count) &&
        action.count > 0 &&
        action.first + action.count <= draft.sampleOps.length &&
        draft.sampleOps[action.first + action.count - 1]?.op === "EMIT_RECORD";
      ids.add(action.id);
      next += action.count;
    }
    valid &&=
      next === draft.sampleOps.length &&
      ![...draft.initOps, ...draft.safeStopOps].some((op) => op.op === "LOAD_ARGUMENT");
    if (!valid)
      errors.push(
        failure(
          DeviceProfileErrorCode.INVALID_RAW_OPERAND,
          ["actions"],
          "actions",
          "Action slices must cover the sample pool exactly, use unique IDs 1..8 and end with EMIT_RECORD",
        ),
      );
  }
  const budget = computeBudget(draft);
  if (budget.totalTimeMs > draft.maxTotalTimeMs) {
    errors.push(
      failure(
        DeviceProfileErrorCode.TIME_BUDGET_EXCEEDED,
        ["maxTotalTimeMs"],
        String(budget.totalTimeMs),
        `computed worst-case time ${budget.totalTimeMs}ms exceeds declared maxTotalTimeMs ${draft.maxTotalTimeMs}ms`,
      ),
    );
  }
  if (budget.transactions > draft.maxTransactions) {
    errors.push(
      failure(
        DeviceProfileErrorCode.TRANSACTION_BUDGET_EXCEEDED,
        ["maxTransactions"],
        String(budget.transactions),
        `computed worst-case transactions ${budget.transactions} exceed declared maxTransactions ${draft.maxTransactions}`,
      ),
    );
  }
  if (budget.bytes > draft.maxBytes) {
    errors.push(
      failure(
        DeviceProfileErrorCode.BYTE_BUDGET_EXCEEDED,
        ["maxBytes"],
        String(budget.bytes),
        `computed worst-case bytes ${budget.bytes} exceed declared maxBytes ${draft.maxBytes}`,
      ),
    );
  }
  if (
    options?.maxOperationCount !== undefined &&
    budget.operations > options.maxOperationCount
  ) {
    errors.push(
      failure(
        DeviceProfileErrorCode.OPERATION_COUNT_EXCEEDED,
        ["operations"],
        String(budget.operations),
        `operation count ${budget.operations} exceeds the supplied cap ${options.maxOperationCount}`,
      ),
    );
  }

  return errors.length > 0 ? err(errors) : ok(budget);
}
