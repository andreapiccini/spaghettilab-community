# @spaghettilab/device-profile-authoring-model

Authoring model for a Device Profile (S061): the declarative acquisition plan that lets
a new sensor/actuator be described entirely as data — transactions, byte operations,
CRC, emitted fields — executed by the firmware's single generic `declarative-device`
Module Driver (firmware phase 325, "Profili dispositivo dichiarativi"), never by
writing new firmware code per sensor.

Every type here is sourced directly from
`firmware/backbone/include/spaghetti/device_profile.h`,
`firmware/backbone/include/spaghetti/port.h`, and `firmware/backbone/include/spaghetti/schema.h`
— not invented from the task prose alone. Where the shipped firmware struct is narrower
than the task text or the phase-325 design doc, this package follows the struct, and
says so (see Honest scope gaps below).

> **Correction (2026-08-13, made while starting S063):** the first revision of this
> package grounded operand meaning only in `enum spaghetti_device_profile_opcode`'s
> one-line comments, and got several operands wrong as a result — e.g. `GPIO_SET` was
> modeled as reading a temp slot when the firmware actually treats `imm0` as an immediate
> boolean and never reads one; `UART_READ_UNTIL`'s stop byte was placed at `imm0` instead
> of the real `imm2`; several opcodes (`I2C_WRITE`, `I2C_READ`, `SPI_TRANSCEIVE`,
> `UART_WRITE`, `ADC_READ`) were missing a `timeoutMs` operand entirely. Fixed by actually
> reading `device_profile_exec.c`'s executor and `device_profile.c`'s
> `accumulate_op_budget` — the real ground truth for operand semantics — not just the
> opcode enum. `instruction.ts` now cites the exact exec/validate function backing each
> operand.

## Instructions (`instruction.ts`, `opcodes.ts`, `raw-op.ts`)

`Instruction` is a discriminated union with one typed, named-field variant per opcode in
`enum spaghetti_device_profile_opcode` (25 opcodes: I2C/SPI/UART/1-Wire transactions, GPIO/ADC,
bounded delay/wait including `WAIT_GPIO`, byte manipulation, CRC8/CRC16, EMIT_FIELD/EMIT_RECORD) — ergonomic
for an editor, instead of raw `imm0`-`imm3` slots. `toRawOp()` compiles each variant down
to `RawDeviceProfileOp`, which mirrors `struct spaghetti_device_profile_op` field for
field, using a **fixed per-opcode mapping** grounded in that struct's own per-field and
per-opcode doc comments (e.g. `I2C_READ`: "Read imm0 bytes into temp" → `imm0` is
`length`) — never an arbitrary/configurable formula (S061 point 3).

`MAX_TEMP_SLOTS` (8) mirrors `SPAGHETTI_DEVICE_PROFILE_TEMP_SLOTS`. `WAIT_FIELD_MASK` and
`WAIT_GPIO` are the only looping constructs (there is no jump/branch opcode) —
`attempts` must be greater than zero, matching the firmware's own `-EINVAL` for a
zero-attempt (unbounded) wait. `SPI_TRANSCEIVE.mode` is 0..3 (`imm3`; `0` is Mode 0).
1-Wire uses `W1_WRITE_READ`; the 8-byte ROM is instance Config `w1_rom`, not the shared
profile. `UART_READ` reads a fixed length; `UART_READ_UNTIL` still stops on a byte.

## Profile (`profile.ts`, `sample-field.ts`, `transport.ts`)

`DeviceProfileDraft` mirrors `struct spaghetti_device_profile` for every field that
struct actually has: `profileId`/`version` (identity), `transport`/`requiredCapabilities`
(`PortTransport`/`PortCapability`, sourced from `port.h`'s
`spaghetti_port_transport`/`spaghetti_port_capability`), declared budget
(`maxTotalTimeMs`/`maxTransactions`/`maxBytes`), `initOps`/`sampleOps`/`safeStopOps`, and
`sampleSchemaId`/`sampleSchemaVersion`/`sampleFields`. Per that struct's own doc comment,
"Instance Port, Bay, label, and bus address are not part of this object" — those live on
`@spaghettilab/physical-composition-model`'s `ModuleNodeData`
(`portId`/`bayId`/`railId`/`endpoint`), never duplicated here.

`SampleField` mirrors `struct spaghetti_device_profile_field`: `int64`/`uint64` only
("MVP supports INT64 and UINT64 only" per the struct's own comment) — this package does
not offer `bool`/`text`/`bytes` sample fields, matching what the firmware struct
actually has today, not what a future MVP might add.

## Port families (firmware 393 / S064)

Same matrix as `firmware/backbone/roadmap/393-device-profile-port-transports`. UART baud and
pinout stay on the Port/DTS, never in the profile. Sample fields stay RAW
(`int64`/`uint64`); no CAN/USB.

| Famiglia Port | Capability | Opcode profilo | Binding istanza |
|---|---|---|---|
| I2C | `CAP_I2C` | `I2C_WRITE` / `READ` / `WRITE_READ` | `i2c_address` |
| SPI | `CAP_SPI` | `SPI_TRANSCEIVE` (`imm3` = mode 0..3) | `spi_cs`, `spi_frequency_hz` |
| UART | `CAP_UART` | `UART_WRITE` / `UART_READ_UNTIL` / `UART_READ` | nessuno (linee/baud sono del Port/DTS) |
| GPIO | `DIGITAL_INPUT` / `OUTPUT` | `GPIO_GET` / `GPIO_SET` / `WAIT_GPIO` | nessuno (una linea per Port) |
| ADC | `CAP_ADC` | `ADC_READ` | `adc_channel` |
| 1-Wire | `CAP_W1` | `W1_WRITE_READ` | `w1_rom` (8 byte, Config di istanza) |

## Validation (`validate-profile.ts`)

`validateDeviceProfile()` checks a draft the way the firmware's own
`spaghetti_device_profile_validate` would — temp-slot bounds (0-7), unbounded
`WAIT_FIELD_MASK`, duplicate/incoherent sample-field schema (every `EMIT_FIELD` must
reference a declared field; every declared field must be emitted by something), and the
computed budget against the profile's own declared limits — collecting every problem
rather than stopping at the first, matching `@spaghettilab/domain`'s `validateProjectV1`
precedent. On success it returns the computed `DeviceProfileBudget`
(`totalTimeMs`/`transactions`/`bytes`/`operations`), mirroring
`spaghetti_device_profile_validate`'s own `out_budget`, written only on success.

`computeBudget()` mirrors `accumulate_op_budget` (`device_profile.c`) exactly, opcode by
opcode — the same fixed formula the firmware itself uses, not a simulation of temp-slot
contents (S061 point 3 explicitly rules out "formule JavaScript arbitrarie", and tracking
dynamic slot contents would be exactly that). Every opcode's contribution to
`totalTimeMs`/`transactions`/`bytes` in `validate-profile.ts` is the same expression the
firmware's own validator computes, verified against that C source directly, not
approximated.

`maxOperationCount` is an optional caller-supplied cap:
`CONFIG_SPAGHETTI_MAX_PROFILE_OPERATIONS`/`..._ACQUISITION_OPERATIONS` are Kconfig-tunable
build settings, not wire data, so this package cannot know them without being told.

## Honest scope gaps

- **No `event`/`command` op arrays.** `struct spaghetti_device_profile` as shipped has
  exactly three op arrays: `init_ops`, `sample_ops`, `safe_stop_ops`. The task text and
  firmware phase 325's design prose both mention "evento/command" as a goal, but the
  committed struct doesn't have a separate array for either — this package models only
  what the struct has, not the aspiration.
- **No separate identity-probe field.** Phase 325's design doc mentions an optional
  probe/identification step, but the struct has no dedicated `probe_ops` array either —
  a probe would need to be expressed as ops within `initOps` today.
- **No fixed-point scale/exponent field.** `spaghetti_device_profile_field` carries only
  `field_id`/`type`/`name`/`unit` — a fixed-point conversion is produced by the
  instruction sequence itself (`SHIFT`/`MASK`/etc. before `EMIT_FIELD`), never declared
  as field metadata, so this package doesn't invent one.
- **Byte budget is an approximation**, not exact — see `computeBudget()`'s note above.
- **This package never encodes a draft to the wire CBOR `INSTALL_DEVICE_PROFILE`
  expects.** S061 explicitly excludes import/export/installation ("senza ancora
  occuparsi di import/export o installazione") — that is S062/S063's job.
