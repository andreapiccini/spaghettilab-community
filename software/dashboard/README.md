# Dashboard SpaghettiLAB

[Indice master Software](../SOFTWARE_MASTER_INDEX.md)

Il **volto grafico** del prodotto: presenta bene ciò che sotto già funziona
(firmware, React Flow, Node-RED). Temi, animazioni e **viste estendibili**
(cards, schema, pack custom) da marketplace o da chi
programma.

## Fa / non fa

| Fa | Non fa |
|---|---|
| Motore di presentazione Flutter | Automazioni / Telegram / regole |
| Appearance, brand, animazioni | Processing / deploy Config |
| ViewMode pluggable (cards, schema) | API dashboard nel firmware |
| Visual Pack store firmato + SDK locale | Eval Dart remoto / pagamento marketplace |
| Comandi manuali su punti esposti | |

## Documentazione

| Doc | Contenuto |
|---|---|
| [DASHBOARD_ARCHITECTURE.md](DASHBOARD_ARCHITECTURE.md) | Confini e prodotto |
| [design/VIEW_MODES.md](design/VIEW_MODES.md) | Viste, Scene, Visual Pack |
| [design/THEMING.md](design/THEMING.md) | Appearance e pack |
| [HOST_API.md](HOST_API.md) | Contratto host |
| [sdk/](sdk/README.md) | Visual Pack JSON locale |
| [roadmap/dashboard-v1/](roadmap/dashboard-v1/README.md) | Task fase 1 |
| [roadmap/dashboard-v2/](roadmap/dashboard-v2/README.md) | Viste e pack |

## Ambiente riproducibile

Dopo clone, **non** dipendere dalla Flutter installata sul PC:

```sh
cd software/dashboard
make ci          # analyze + test + build web in Docker
make dev-web     # hot reload UI su browser → http://127.0.0.1:8080
make broker      # Mosquitto locale 1883 + WebSocket 9001 (opzionale)
```

Pin SDK: **Flutter 3.32.8** via FVM (`.fvmrc`) e immagine `ghcr.io/cirruslabs/flutter:3.32.8`.
Dettaglio, limiti iOS/macOS in container, Dev Containers: [ENVIRONMENT.md](ENVIRONMENT.md).

## Fase 1

Chiusa il **2026-08-16** (D080). 9 schermate + fake host + Host API V1.
Fase 2: Scene + Schema; Pianta/Dentro ritirati.

### Demo 5 minuti

1. `make dev-web` → http://127.0.0.1:8080
2. Canvas: temperatura a gauge, pompa ferma → toggle **In funzione**
3. Tap card → dettaglio + storico host
4. **Aspetto**: swatch / sfondo / motion; preview live
5. **Pack** → Applica **Garden** (conferma) → accent verde
6. **Modifica** → Aggiungi widget **Luminosità**

Core MQTT (opzionale): `make broker`, poi Host → Aggiungi sistema con
`mqtt://127.0.0.1:1883/v1/cores/<id>` (sul web: WebSocket `127.0.0.1:9001`).
Host cloud: `cloud://loopback` (JSON HOST_API in-process) o `https://…/v1`.
**Core live** resta il simulatore MQTT in loopback.

## Stato

| Pezzo | Stato |
|---|---|
| D010 Architettura | ✅ documenti in repo |
| D011 Scaffold Flutter + Docker | ✅ `app/` + `packages/dashboard_domain` + Compose |
| D020 Inventario spec UX | ✅ 9 schermate specificate |
| D021–D029 Schermate | ✅ spec + UI fake host |
| D023 Canvas | ✅ gauge, pompa rotante, sparkline |
| D030 Dominio + HostPort | ✅ Dart puro, test |
| D031 Registry renderer | ✅ `CardsRenderer` |
| D040 Fake host | ✅ Casa demo (pompa, temperatura, pack fake) |
| D050 Shell | ✅ nav + ThemeProvider da appearance |
| D051 Schermate wired | ✅ |
| D070 HOST_API freeze | ✅ V1 2026-08-16 |
| D080 Gate fase 1 | ✅ 2026-08-16 |
| D200–D220 Scene / Schema | ✅ (Pianta ritirata) |

## Presentazione leggera sul Raspberry

`sh scripts/build-fair-web.sh` compila `lib/main_fair.dart` in release usando la
stessa UI e `FakeHost`, senza login o host live. Le risorse web sono locali e non
viene attivata una cache PWA. La normale applicazione `lib/main.dart` è invariata.
Sul Raspberry si servono solo i file generati in `app/build/web`, con i comandi
[`dashboard` e `demo` del chiosco](../micro-flow-editor/scripts/fair-kiosk/README.md).
