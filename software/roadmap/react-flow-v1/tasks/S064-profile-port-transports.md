# S064 — Device Profile: famiglie Port complete (1-Wire, UART_READ, SPI mode, WAIT_GPIO)

**Stato:** ✅ DONE
**Dipende da:** S063, firmware [393](../../../../firmware/backbone/roadmap/393-device-profile-port-transports/README.md)

## Obiettivo

Lo Studio e l'authoring model dichiarano già `PortTransport.W1` / `PortCapability.W1`
(`transport.ts`, da `port.h`). Firmware [393](../../../../firmware/backbone/roadmap/393-device-profile-port-transports/README.md)
ha aggiunto opcode 23–25 e `SPI_TRANSCEIVE.imm3`. L'authoring model e il selettore
step dello Studio sono allineati. Il campo Config Inspector `w1_rom` è sul Module
`declarative-device` (8 byte hex, binding di istanza).

## Implementazione richiesta

1. Dopo TASK-393-01 e 393-02: aggiungi al modello authoring, con gli stessi
   operandi del firmware:
   - `W1_WRITE_READ` (23);
   - `UART_READ` (24) — length + timeoutMs, distinto da `UART_READ_UNTIL`;
   - `WAIT_GPIO` (25) — attempts, intervalMs, expectedLevel;
   - `SPI_TRANSCEIVE.mode` 0..3 mappato su `imm3` (default 0).
2. Studio (UI-S060): tab Transport include 1-Wire; Inspector Module
   `declarative-device` espone `w1_rom` (8 byte hex) come già `i2c_address` /
   `spi_cs`. Selettore opcode: categorie "Transazione 1-Wire", "UART read N",
   "Attendi GPIO". Campo mode sulla riga SPI transceive.
3. Documenta nella README authoring la matrice famiglie Port (stesso contenuto
   della fase 393): UART baud/pinout restano del Port/DTS, non del profilo.
4. Non aggiungere CAN/USB. Non esporre calibrazione: i campi sample restano RAW
   (INT64/UINT64); `EMIT_FIELD` scale `imm3` del firmware, se si cablano
   width/endian/scale, è opzionale e non sostituisce la calibrazione host.

## Verifiche

- un draft `transport=W1` con `W1_WRITE_READ` + `EMIT_FIELD` passa validate
  locale e `opcodeDependencies` contiene 23;
- `UART_READ` / `WAIT_GPIO` / SPI `mode: 3` compilano `imm*` come 393-02;
- su un Core senza opcode 23–25 il resolver S062/S104 dà
  `FIRMWARE_UPDATE_REQUIRED`;
- I2C/SPI Mode 0/`UART_READ_UNTIL`/GPIO get-set non regrediscono.

## Fine task

- [x] Opcode e binding 1-Wire nel modello authoring.
- [x] `UART_READ`, `WAIT_GPIO`, SPI mode 0..3 nel modello e nello Studio (categorie step).
- [x] Studio: campo Config Inspector `w1_rom` (8 byte hex) su `declarative-device`.
- [x] Matrice Port documentata; niente famiglie fuori da Port.
