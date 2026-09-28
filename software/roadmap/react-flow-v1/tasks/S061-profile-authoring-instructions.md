# S061 — Modello authoring ed editor istruzioni

**Stato:** ✅ DONE
**Dipende da:** S043; integrabile con S050

## Obiettivo

Permettere di descrivere completamente un sensore/attuatore compatibile con gli opcode
già installati, senza ancora occuparsi di import/export o installazione.

## Implementazione richiesta

1. Implementa modello authoring completo per metadata, transport, capability/elettrico,
   identity probe, init, sample, event, command, safe-stop e output schema.
2. Fornisci editor funzionale delle istruzioni catalogate: transazioni I2C/SPI/UART,
   GPIO/ADC, wait bounded, byte operations, mask/shift/sign, CRC ed emit.
3. Gestisci fixed-point, endian, signedness, unità, field ID e versionamento schema
   senza formule JavaScript arbitrarie.

## Verifiche

- si possono creare due sensori con mappe registri diverse sullo stesso driver
  dichiarativo;
- un profilo con init, polling ready, CRC e più output si costruisce interamente
  nell'editor;
- loop, timeout, buffer, schema o field duplicato sono rifiutati con path preciso
  nell'errore.

## Fine task

- [x] Un profilo può essere descritto interamente senza codice host/Core arbitrario.
- [x] I vincoli elettrici derivano dalla Bay (S050), non dal testo del profilo.

## Implementazione (2026-08-13)

Nuovo pacchetto `@spaghettilab/device-profile-authoring-model`
(`software/micro-flow-editor/packages/device-profile-authoring-model/`), che dipende
solo da `domain`. Ogni tipo è preso direttamente da
`firmware/backbone/include/spaghetti/device_profile.h`, `port.h` e `schema.h` (letti nel
codice reale, non dedotti dal solo testo del task), non inventato.

**Istruzioni** (`instruction.ts`, `opcodes.ts`, `raw-op.ts`): union discriminata con
una variante tipata per ciascuno dei 22 opcode di
`enum spaghetti_device_profile_opcode` (transazioni I2C/SPI/UART, GPIO/ADC, delay/wait
bounded, operazioni sui byte, CRC8/CRC16, EMIT_FIELD/EMIT_RECORD) — punto 2 del task.
`toRawOp()` compila ogni variante in `RawDeviceProfileOp`, che rispecchia
`struct spaghetti_device_profile_op` campo per campo, con una mappatura fissa per
opcode basata sui commenti stessi della struct firmware — mai una formula arbitraria
(punto 3: "senza formule JavaScript arbitrarie"). `WAIT_FIELD_MASK` è l'unico costrutto
di loop nell'instruction set (non esiste alcun opcode di jump/branch): `attempts` deve
essere maggiore di zero, come il firmware stesso rifiuta un'attesa a zero tentativi.

**Profilo** (`profile.ts`, `sample-field.ts`, `transport.ts`): `DeviceProfileDraft`
rispecchia `struct spaghetti_device_profile` per ogni campo che quella struct ha
davvero — identity, transport/capability (`PortTransport`/`PortCapability` da
`port.h`), budget dichiarato, `initOps`/`sampleOps`/`safeStopOps`,
schema/`sampleFields`. Per esplicito commento della struct firmware, "Instance Port,
Bay, label, and bus address are not part of this object" — questi vivono su
`ModuleNodeData` di `physical-composition-model` (S050), mai duplicati qui: è quanto
soddisfa "I vincoli elettrici derivano dalla Bay, non dal testo del profilo".
`SampleField` supporta solo `int64`/`uint64` ("MVP supports INT64 and UINT64 only" —
commento reale della struct).

**Validazione** (`validate-profile.ts`): `validateDeviceProfile()` verifica bound dei
temp slot (0-7), `WAIT_FIELD_MASK` non bounded, schema/field duplicato o incoerente
(ogni `EMIT_FIELD` deve referenziare un field dichiarato; ogni field dichiarato deve
essere emesso), e il budget calcolato contro i limiti dichiarati dal profilo stesso —
raccogliendo tutti i problemi invece di fermarsi al primo. `computeBudget()` usa una
formula fissa per opcode (mai una simulazione dinamica dei temp slot, che sarebbe
esattamente la "formula arbitraria" vietata dal punto 3): solo gli opcode con un
operando di lunghezza esplicito contribuiscono al conteggio byte.

**Test**: 16 nuovi test in 2 file, coprono direttamente ogni bullet delle Verifiche
(due sensori con mappe registri diverse, profilo con init+polling+CRC+più output,
rifiuto di loop/timeout/buffer/field duplicato con path preciso). CI completa (lint,
typecheck, test, build) verde via Docker.

**Scope onestamente incompleto** (dettagliato nel README del pacchetto): la struct
firmware realmente spedita ha solo tre array di operazioni (`init_ops`/`sample_ops`/
`safe_stop_ops`) — niente array `event`/`command` separati, nonostante il testo del
task e il design doc della fase 325 li menzionino come obiettivo; nessun campo
fixed-point/scale dichiarativo (la conversione avviene nella sequenza di istruzioni
stessa); questo pacchetto non produce mai il CBOR wire che `INSTALL_DEVICE_PROFILE` si
aspetta — import/export/installazione restano volutamente fuori scope (S062/S063).

## Correzione (2026-08-13, durante l'avvio di S063)

La prima revisione di questo pacchetto aveva fondato il significato degli operandi solo
sui commenti a riga singola di `enum spaghetti_device_profile_opcode`, senza leggere
l'eseguitore reale — risultato: diversi operandi erano sbagliati (`GPIO_SET` modellato
come lettura di un temp slot invece di un booleano immediato in `imm0`; lo stop byte di
`UART_READ_UNTIL` posizionato su `imm0` invece del vero `imm2`; `I2C_WRITE`/`I2C_READ`/
`SPI_TRANSCEIVE`/`UART_WRITE`/`ADC_READ` senza l'operando `timeoutMs` che hanno
davvero). Corretto leggendo `firmware/backbone/subsys/device_profiles/device_profile_exec.c`
(l'eseguitore) e `device_profile.c`'s `accumulate_op_budget` (il validatore reale) —
non più solo l'enum degli opcode. `computeBudget()` ora rispecchia `accumulate_op_budget`
esattamente, byte per byte, non più un'approssimazione. 21 test (5 nuovi) verificano la
correzione, CI Docker verde.
