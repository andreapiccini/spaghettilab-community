# Fase 393 — Trasporti Port nei Device Profile

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Far sì che un sensore esterno su **qualunque famiglia elettrica già esposta da
Port** si aggiunga come Device Profile installabile, senza compilare un Module
Driver per quel part number.

La Port V1 dichiara già I2C, SPI, UART, GPIO, ADC e 1-Wire
(`enum spaghetti_port_transport` / `spaghetti_port_capability`). L'interprete
325 esegue le prime cinque famiglie, con tre buchi pratici (UART solo fino a
uno stop byte, SPI fisso Mode 0, wait solo I2C) e **senza** 1-Wire.

## Copertura attuale (325) vs Port

| Famiglia Port | Capability | Opcode profilo oggi | Binding istanza oggi |
|---|---|---|---|
| I2C | `CAP_I2C` | `I2C_WRITE` / `READ` / `WRITE_READ` | `i2c_address` |
| SPI | `CAP_SPI` | `SPI_TRANSCEIVE` (`imm3` = mode 0..3) | `spi_cs`, `spi_frequency_hz` |
| UART | `CAP_UART` | `UART_WRITE` / `UART_READ_UNTIL` / `UART_READ` | nessuno (linee/baud sono del Port/DTS) |
| GPIO | `DIGITAL_INPUT` / `OUTPUT` | `GPIO_GET` / `GPIO_SET` / `WAIT_GPIO` | nessuno (una linea per Port) |
| ADC | `CAP_ADC` | `ADC_READ` | `adc_channel` |
| 1-Wire | `CAP_W1` | `W1_WRITE_READ` | `w1_rom` (8 byte) |

Fuori ambito V1: CAN, USB host, Ethernet, PWM, radio. Non sono famiglie Port.
Un protocollo tipo Modbus-RTU bounded sta su UART: dopo 393-02 (`UART_READ` +
CRC16 già in 325) non serve un driver C.

Nuovi opcode = **un** aggiornamento firmware (Capability Pack / immagine). Dopo
quello, ogni chip su quella famiglia è di nuovo solo un profilo dati.

## Task

1. ✅ [TASK-393-01 — Aggiungere 1-Wire e il binding ROM ai profili](TASK-393-01-aggiungere-one-wire-e-binding-rom-ai-profili.md)
2. ✅ [TASK-393-02 — UART a lunghezza fissa, mode SPI, WAIT_GPIO](TASK-393-02-uart-read-spi-mode-wait-gpio.md) — in parallelo a 01

## Criteri di completamento della fase

- [x] Un profilo `transport=W1` valida, si installa e campiona via
      `spaghetti_port_w1_write_read` senza un driver C del chip.
- [x] Il Module `declarative-device` accetta la ROM a 8 byte in Config.
- [x] `UART_READ` legge N byte con timeout; `UART_READ_UNTIL` resta.
- [x] `SPI_TRANSCEIVE` accetta mode 0..3; `imm3=0` resta Mode 0.
- [x] `WAIT_GPIO` attende un livello digitale bounded; senza input → `-ENOTSUP`.
- [x] Un firmware senza i nuovi opcode rifiuta il profilo (`-ENOTSUP` /
      `FIRMWARE_UPDATE_REQUIRED`); non inventa transazioni.
- [x] I profili I2C/SPI Mode 0/UART-until/GPIO esistenti restano invariati sul wire.
