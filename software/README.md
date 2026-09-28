# SpaghettiLAB Software

**Indice master (revisione globale):** [`SOFTWARE_MASTER_INDEX.md`](SOFTWARE_MASTER_INDEX.md) —
visione prodotto, confini, stato di tutte le roadmap, checklist task mancanti.

## Catena prodotto

```text
Firmware → React Flow (ingegneria) → Node-RED (automazioni)
                ↓                           ↓
         Dashboard Host (edge/cloud) ← exposure + auth
                ↓
         Dashboard Flutter (presentazione grafica)
```

Due modelli: **ecosistema** (progettista implementa) e **turnkey Site Package**
(cliente usa dashboard già configurata on-prem). Vedi
[`DEPLOYMENT_ACCESS_MODEL.md`](DEPLOYMENT_ACCESS_MODEL.md).

## Componenti

| Componente | Path | Roadmap |
|---|---|---|
| **React Flow** — configura Core, deploy, profili | [`micro-flow-editor/`](micro-flow-editor/) | [react-flow-v1](roadmap/react-flow-v1/README.md) |
| **Module Tag Studio** — programma / verifica tag NFC SLM1 | [`module-tag-studio/`](module-tag-studio/) | [README](module-tag-studio/README.md) |
| **Node-RED** — integrazioni, Telegram, logiche always-on | [`node-red/`](node-red/) | S112–S113 · [E060](roadmap/ecosystem-access-v1/tasks/E060-nodered-auth-scoped-access.md) |
| **Dashboard** — UI Flutter, temi, viste, marketplace grafico | [`dashboard/`](dashboard/) | [dashboard-v1](dashboard/roadmap/dashboard-v1/README.md) |
| **Access & turnkey** — ruoli, Site Package, Support Grant | — | [ecosystem-access-v1](roadmap/ecosystem-access-v1/README.md) |

## Documentazione chiave

### Ingegneria (React Flow)

- [Architettura funzionale](REACT_FLOW_ARCHITECTURE.md)
- [Architettura UI/UX](UX_ARCHITECTURE.md) · [`ux/screens/`](ux/screens/)
- [Roadmap UX (doc schermate)](roadmap/ux-v1/README.md) — ✅ completa

### Dashboard (presentazione)

- [Architettura dashboard](dashboard/DASHBOARD_ARCHITECTURE.md)
- [View modes & Visual Pack](dashboard/design/VIEW_MODES.md)
- [Theming](dashboard/design/THEMING.md)
- [HOST_API](dashboard/HOST_API.md) · [Ambiente Docker/FVM](dashboard/ENVIRONMENT.md)
- [Spec UX dashboard](dashboard/ux/README.md) — ✅ 9 schermate

### Deployment e accessi

- [Modello deployment, ruoli, turnkey](DEPLOYMENT_ACCESS_MODEL.md)

## Stato sintetico (2026-08-13)

| Roadmap | Implementazione |
|---|---|
| React Flow S010–S080 | ✅ |
| React Flow S092–S130 | ⬜ 11 task |
| UX React Flow | ✅ doc |
| Dashboard D010–D080 | ✅ gate 2026-08-16 |
| Ecosystem E010 | ✅ doc |
| Ecosystem E020 · E021 · E050 · E051 · E080 | ✅ stub + login + utenti + grant |
| Ecosystem E060–E090 | ⬜ 5 task |

Dettaglio e checklist completa: [**SOFTWARE_MASTER_INDEX.md § 6**](SOFTWARE_MASTER_INDEX.md#6-elenco-task-mancanti-checklist-revisione).

## Avvio rapido (componenti esistenti)

```sh
# React Flow + USB bridge for Safari (Docker)
cd software/micro-flow-editor && make up-d

# Module Tag Studio (simulato)
cd software/module-tag-studio && npm install && npm run dev

# Node-RED locale
cd software/node-red && docker compose up -d

# Dashboard (dopo D011)
cd software/dashboard && make ci    # documentato in ENVIRONMENT.md
```
