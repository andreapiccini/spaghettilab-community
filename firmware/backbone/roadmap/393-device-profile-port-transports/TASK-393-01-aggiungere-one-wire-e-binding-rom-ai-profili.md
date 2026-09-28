# TASK-393-01 — Aggiungere 1-Wire e il binding ROM ai profili

**Stato:** ✅ DONE
**Fase:** 393 — Trasporti Port nei Device Profile

## Orientamento (concetto già in Port)

**Cos'è.** 1-Wire è una famiglia elettrica della Port, non un nuovo bus inventato
dal profilo. Il contratto I/O esiste già:
[`spaghetti_port_w1_write_read`](../../include/spaghetti/port.h) — transazione
bounded verso una ROM da 8 byte.

**A cosa serve.** DS18B20 e analoghi: il profilo descrive write/read e i campi
RAW; la ROM è dell'istanza Module, come l'indirizzo I2C.

**Quando.** Runtime, thread context, lock Port già preso dal Module Manager.

**Build-time vs runtime.** Gli opcode nuovi stanno nell'immagine (vocabulario).
Il chip specifico no: arriva con `INSTALL_DEVICE_PROFILE`.

**File da toccare.** `include/spaghetti/device_profile.h` (opcode + binding),
`subsys/device_profiles/device_profile_exec.c`, `device_profile.c` (validate/
budget), `spaghetti_modules/declarative_device/`, `PROTOCOL_V1.md`,
`tests/device_profiles`. Non toccare `port.c` se `w1_write_read` basta.

**Non modificare.** Driver INA219/Relay, tabelle Registry, Discovery provider
1-Wire (resta chi *propone* la ROM; il profilo *parla* alla ROM già scelta).

## Cosa devo fare

1. Aggiungi opcode `SPAGHETTI_DEVICE_PROFILE_OP_W1_WRITE_READ` (prossimo libero:
   23). Operandi allineati alla Port API: `src_a` = TX temp, `dst` = RX temp,
   `imm0` = `read_size`, `imm1` = `write_size` (0 = usa `src_a->size`),
   `imm2` = timeout_ms. La ROM arriva da
   `spaghetti_device_profile_binding`, non dal profilo condiviso.
2. Estendi `struct spaghetti_device_profile_binding` con `uint8_t w1_rom[8]`.
   Campo Config `declarative-device`: `w1_rom` BYTES, 8 byte, opzionale come
   `i2c_address`. Decode in `resolve_profile`.
3. Validate: profilo `transport=W1` richiede `CAP_W1`; opcode W1 su altro
   transport → inconsistente. Budget: 1 transazione + `write+read` byte.
4. Bump `SPAGHETTI_DEVICE_PROFILE_OPCODE_VERSION` se l'host deve distinguere
   il vocabolario. Wire CBOR del profilo resta v1 (opcode numerico extra).
   Firmware vecchio rifiuta opcode 23 come già fa per gli sconosciuti.
5. Test native: fake Port W1, profilo installato, sample RAW, ROM assente →
   `-EINVAL`, Port senza `CAP_W1` → `-ENOTSUP`. I test I2C/SPI esistenti
   restano verdi.
6. Documenta la matrice famiglie Port ↔ opcode in
   [`EXTENDING_SPAGHETTI_LAB.md`](../../EXTENDING_SPAGHETTI_LAB.md) § 9.

Non aggiungere CAN/USB/PWM. Non mettere calibrazione negli opcode. UART_READ /
SPI mode / WAIT_GPIO stanno in [393-02](TASK-393-02-uart-read-spi-mode-wait-gpio.md),
non in questo file.

Follow-up host (non questo file): [S064](../../../../../software/roadmap/react-flow-v1/tasks/S064-profile-port-transports.md).

## Checklist di completamento

- [x] Opcode W1 esegue `spaghetti_port_w1_write_read` con ROM di binding.
- [x] Config `declarative-device` espone `w1_rom` (8 byte).
- [x] Validate/budget coprono transport W1 e opcode sconosciuto invariato.
- [x] Test native: sample RAW, ROM mancante, Port senza 1-Wire.
- [x] `EXTENDING_SPAGHETTI_LAB.md` § 9 elenca I2C/SPI/UART/GPIO/ADC/W1.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/device_profiles -T tests/templates \
   -p native_sim/native/64 --inline-logs --clobber-output'
```
