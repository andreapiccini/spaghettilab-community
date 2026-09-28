# TASK-393-02 — UART a lunghezza fissa, mode SPI, WAIT_GPIO

**Stato:** ✅ DONE
**Fase:** 393 — Trasporti Port nei Device Profile
**Dipende da:** nessuna dipendenza da 393-01 (stesso interprete, famiglie già in Port)

## Perché

1-Wire (393-01) chiude l'unica famiglia Port senza opcode. Restano tre buchi
**sulle famiglie già eseguite**, che tengono fuori profili reali:

- UART: solo `READ_UNTIL` (stop byte) → niente frame binari (PMS, MH-Z19,
  Modbus RTU + CRC16 già presente).
- SPI: `SPI_TRANSCEIVE` forza Mode 0 / MSB → tanti ADC/sensori sono Mode 3.
- GPIO: `WAIT_FIELD_MASK` fa solo I2C → PIR, reed, pin ready.

Niente famiglie nuove, niente CAN/USB/PWM, niente calibrazione.

## Cosa devo fare

### UART_READ (opcode 24)

Oggi Port ha solo `spaghetti_port_uart_write` e `spaghetti_port_uart_read_until`.
Aggiungi `spaghetti_port_uart_read()` bounded: buffer caller-owned, `len`
esatto, timeout ≠ `K_FOREVER`. Timeout o short read → `-ETIMEDOUT` / `-EIO`,
mai un frame parziale silenzioso.

Opcode: `dst` = RX temp, `imm0` = length, `imm1` = timeout_ms.
Validate: `transport` UART o `CAP_UART`; `imm0` > 0 e ≤ temp max.
`UART_READ_UNTIL` resta invariato.

### SPI mode (nessun opcode nuovo)

`exec_spi` oggi fissa `SPI_OP_MODE_MASTER | SPI_WORD_SET(8) | SPI_TRANSFER_MSB`.
Usa `imm3` di `SPI_TRANSCEIVE` come mode 0..3 (CPOL/CPHA Zephyr). `imm3 == 0`
resta Mode 0 — i profili esistenti non cambiano. Valori 4..UINT32_MAX →
validate `-EINVAL`. Non aggiungere dual/quad SPI.

Mode è del **profilo** (datasheet), non del Module instance. Non serve un
campo Config `declarative-device`.

### WAIT_GPIO (opcode 25)

Stesso schema di `WAIT_FIELD_MASK` (attempts `imm0`, interval_ms `imm1`) ma
chiama `spaghetti_port_get_input`. `imm2` = livello atteso (0 o 1).
Timeout → `-ETIMEDOUT`.

Validate: richiede `CAP_DIGITAL_INPUT`. Non obbligare `transport == GPIO`:
un profilo I2C può attendere un alert pin se la Port espone anche il digitale
(connettore a cinque segnali). Senza capability → `-ENOTSUP`.

Non introdurre attesa sul fronte in microsecondi (DHT, HC-SR04): `interval_ms`
resta millisecondi come il resto dell'interprete.

### Vocabolario

Bump `SPAGHETTI_DEVICE_PROFILE_OPCODE_VERSION` insieme a 393-01 (stesso bump
di fase se 01 è già passato, altrimenti un solo bump a fine 393). Wire CBOR
profilo resta v1. Firmware vecchio rifiuta 24/25 come opcode sconosciuti.

File: `port.h` / `port.c` (solo UART read), `device_profile.h`,
`device_profile_exec.c`, `device_profile.c`, `PROTOCOL_V1.md`,
`tests/device_profiles`, `tests/port` se esiste suite UART.
Non toccare INA219, Registry, 393-01 se già mergiato.

Follow-up host: [S064](../../../../../software/roadmap/react-flow-v1/tasks/S064-profile-port-transports.md).

## Checklist di completamento

- [x] `spaghetti_port_uart_read` bounded, lunghezza esatta, nessun forever.
- [x] Opcode `UART_READ` (24) + test frame binario / timeout.
- [x] `SPI_TRANSCEIVE` `imm3` = mode 0..3; `0` = Mode 0 come oggi.
- [x] Opcode `WAIT_GPIO` (25) su `get_input`; senza `CAP_DIGITAL_INPUT` → `-ENOTSUP`.
- [x] `UART_READ_UNTIL` e i profili SPI Mode 0 esistenti restano verdi.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/device_profiles -T tests/port \
   -p native_sim/native/64 --inline-logs --clobber-output'
```

Se `tests/port` non copre UART, aggiungi i casi UART read in `tests/device_profiles`
con fake Port e non inventare una suite vuota.
