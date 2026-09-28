# TASK-342-01 — Implementare blocchi di elaborazione dichiarativi

**Stato:** ✅ DONE
**Fase:** 342 — Blocchi di elaborazione dichiarativi

## Cosa devo fare

### 1. Introdurre Block Driver e Registry

Crea `include/spaghetti/block_driver.h`, `subsys/block_registry/`,
`subsys/processing/` e `tests/processing/`. Un Block Driver è codice compilato,
versionato e auto-registrato tramite iterable section. Il descrittore dichiara:

- `type_id`, API version e versione algoritmo;
- schema proprietà;
- porte di input/output e tipi accettati;
- stato per istanza, allineamento e workspace temporaneo;
- costo massimo per record e capability richieste;
- operazioni `validate`, `init`, `process`, `reset`, `deinit`.

Il Registry è immutabile dopo il boot e il catalogo enumera soltanto blocchi realmente
compilati. `process()` riceve valori copiati e produce output bounded; non effettua I/O
hardware e non chiama direttamente Module Manager.

### 2. Estendere Config con un processing graph normalizzato

Aggiungi a Config array bounded di `block` ed `edge`. Ogni blocco ha key stabile,
`type_id`, versione minima/esatta e property set; ogni edge riferisce source
module/block + field/port e target block + input. Config non conserva coordinate,
colori o metadati di editor.

Incrementa versione in-memory e wire, estendi CDDL/encoder/hash canonico e conserva un
decoder legacy della fase 330. Storage migra atomicamente le Config senza graph a
`block_count = 0` e `edge_count = 0`; payload sconosciuti non vengono reinterpretati.

La validazione deve risolvere schemi e tipi, rifiutare key/edge duplicati, cicli,
input obbligatori scollegati, fan-out oltre limite, blocchi assenti, versioni
incompatibili e budget CPU/RAM superiori al profilo. Il grafo accettato è compilato in
un execution plan topologicamente ordinato e posseduto da Runtime.

Feedback e stato temporale non usano cicli: blocchi espliciti `delay`, `previous` o
filtri stateful possiedono lo stato fra record. Apply è transazionale e ripristina
grafo e context precedenti se una nuova istanza fallisce.

### 3. Fornire un set base di blocchi

Implementa almeno:

```text
scale_offset, clamp, map_range
mask_shift, combine_fields, select
add, subtract, multiply, divide
moving_average, low_pass, median
threshold, hysteresis, debounce
lookup_table, polynomial
unit_convert, publish_field
```

INT64/UINT64 e fixed-point restano il formato canonico. Ogni operazione definisce
overflow, saturazione, divisione per zero, scala e unità; nessuna conversione è
silenziosa. I blocchi con coefficienti o tabelle grandi riferiscono artefatti
persistiti bounded invece di gonfiare ogni Config.

Il filtro Kalman è un Block Driver opzionale di esempio: può essere compilato in un
Capability Pack, dichiara esattamente stato/workspace e usa fixed-point o abilita una
capability numerica esplicita. Il Config lo usa come qualsiasi altro blocco dopo che
compare nel catalogo.

### 4. Coordinare esecuzione e pubblicazione

Runtime consegna ogni record al piano applicabile, propaga output in ordine
topologico e pubblica record derivati con source, schema, timestamp, sequence e
provenance del grafo. Imposta limiti per profondità, operazioni per record e tempo;
un errore di blocco incrementa stats, interrompe soltanto quella pipeline e non ferma
acquisizione o altre pipeline.

Safe state e azioni hardware continuano a passare da Rule Driver/Module command. Un
blocco matematico non ottiene implicitamente permesso di comandare uscite.

### 5. Testare estensione e assenza

Aggiungi un blocco fake fuori da Registry/Runtime centrali e verifica che compaia nel
catalogo senza patch centrali. Prova pipeline multi-stage, fan-out, due sorgenti,
filtro stateful, overflow, reset, coda piena, ciclo, tipo incompatibile, blocco assente,
budget superato e rollback.

## Perché è fatto così

Il firmware contiene implementazioni riusabili; il Config ne crea e collega le
istanze. Questo rende no-code l'uso e la composizione senza consentire esecuzione di
codice arbitrario inviato dall'host.

## Checklist di completamento

- [x] Block Registry non contiene elenchi concreti.
- [x] Config e wire rappresentano block/edge bounded e UI-neutral.
- [x] Ogni grafo è validato per tipi, cicli, risorse e versione.
- [x] Stato è allocato soltanto per blocchi attivi.
- [x] Kalman opzionale dimostra un blocco aggiunto via firmware e usato via Config.
- [x] Errori di una pipeline non fermano Runtime.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/processing -p native_sim/native/64 --inline-logs --clobber-output'
make pristine
```
