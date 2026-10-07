# Spaghetti LAB Community Hub

Server centrale locale per catalogo NFC, marketplace, firmware, progetti, votazioni e contest. Richiede Node.js 22 o successivo; nessuna dipendenza da installare.

## Avvio locale

Da questa cartella: `npm start`. Su Windows `./start.ps1` lo avvia in background senza una finestra aggiuntiva, evitando un secondo avvio sulla porta predefinita.

- Pannello: http://127.0.0.1:8790/admin
- L’app Micro Flow Editor usa questo indirizzo automaticamente. Il pulsante del server nella home permette di cambiarlo.
- Dati e file persistenti in `data/`; esclusi da Git. Per il backup arrestare il servizio e copiare tutta la cartella. Avviare una sola istanza per cartella dati.
- Arresto del processo in background: identificare il processo Node del Community Hub tramite il percorso `src/server.mjs` e arrestare quello. Il servizio in primo piano si arresta con Ctrl+C.

Il pannello locale autentica automaticamente soltanto richieste dalla macchina locale con origine locale. Una chiave amministrativa viene generata in `data/admin-token.txt`; non condividerla. Le sessioni scadono dopo 24 ore e al riavvio del server. Account e password cifrate con scrypt persistono.

## Pubblicazione

Le sezioni del pannello gestiscono articoli/progetti, moduli NFC, pacchetti, votazioni, contest e candidature. Creare una bozza, caricare la copertina (PNG/JPEG/WebP) o un file (massimo 64 MiB), completare i campi e selezionare **Pubblicato** prima di salvare. I file delle bozze sono disponibili solo agli amministratori. La rimozione di un contenuto lo ritira dalla pubblicazione, mantenendo lo storico.

I moduli usano la chiave completa registro/produttore/tipo. Un pinout elettrico opzionale deve contenere sei pin coerenti con i quattro modi configurabili: 5V, quattro segnali, GND. I²C occupa SDA e SCL sui primi due segnali. Il catalogo pubblicato sincronizza la configurazione fisica dell’app; le definizioni locali del progetto hanno precedenza.

Per firmware scegliere tipo Firmware, specificare versione e scheda di destinazione, caricare il binario firmato generato dalla build, quindi pubblicare. La pubblicazione notifica i client connessi tramite SSE e aggiorna il marketplace; gli utenti scaricano il file con verifica SHA-256. L’installazione sulla backbone segue il flusso OTA esistente, con verifica della compatibilità e scelta dell’utente. Una pubblicazione non avvia automaticamente un flash.

Capability pack e device profile possono includere il manifest JSON nel formato già supportato dal marketplace dell’app. Il file è scaricabile nella sezione Market; l’indice dei manifest alimenta anche Capability Marketplace. La verifica SHA-256 protegge l’integrità del download; la fiducia nella firma del pacchetto resta gestita dai controlli esistenti.

Le votazioni richiedono un account: un voto per account, modificabile finché la votazione è aperta. I contest accettano una candidatura per account. La sezione Candidature permette di consultare i progetti e assegnare un premio, pubblicando nome pubblico e titolo del vincitore. I contenuti iniziali sono dimostrativi e modificabili.

## Ospitalità futura

Configurazione tramite variabili d’ambiente:

| Variabile | Default / uso |
| --- | --- |
| `HUB_HOST` | `127.0.0.1`; per hosting usare l’interfaccia interna prevista |
| `HUB_PORT` | `8790` |
| `HUB_DATA_DIR` | Cartella `data` del server; volume persistente |
| `HUB_ADMIN_TOKEN` | Obbligatorio quando l’ascolto non è locale; segreto lungo casuale |
| `HUB_LOCAL_ADMIN` | `0` disabilita l’accesso automatico locale |
| `HUB_PUBLIC_ORIGIN` | Origine HTTPS del server, ad esempio `https://hub.example.org` |
| `HUB_ALLOWED_ORIGINS` | Origini client separate da virgole; default localhost e 127.0.0.1 sulla porta 5173 |
| `HUB_SECURE_COOKIES` | `1` per cookie amministrativi Secure dietro HTTPS |

Esporre tramite reverse proxy HTTPS, impostare l’origine pubblica e le origini dei client, conservare i dati su disco persistente e consentire connessioni SSE senza buffering. Il client accetta HTTP solo su loopback e mantiene una copia dell’ultimo catalogo per la consultazione offline. Questa implementazione usa un archivio JSON atomico per una singola istanza: per più istanze e grandi volumi migrare a un database condiviso. Recupero password, verifica e-mail, pagamenti e aggiornamento automatico dell’app desktop non sono inclusi.

## API e verifiche

API versionata `/api/v1`: `sync` (ETag), `nfc`, `marketplace-index`, `events` (SSE), `files/:sha256`, `auth/*`, `account`, `polls/:id/vote`, `contests/:id/submissions`, `admin/state`, `admin/uploads`, `admin/{modules,packages,posts,polls,contests}`, `admin/awards`.

`npm test` verifica pubblicazione, protezione delle bozze, download, push, unicità NFC, configurazione elettrica, voti, candidature, premi, scritture concorrenti e persistenza.
