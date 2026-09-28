# Node-RED

A minimal Docker Compose environment running the official [Node-RED](https://nodered.org/)
image, pinned to version `5.0.4`.

This is a first, self-contained step: a working local Node-RED editor with
persistent flow storage, skinned with basic Spaghetti LAB branding (colors,
logo, page title). It does **not** yet include MQTT, a Spaghetti LAB
firmware connection, custom nodes, a dashboard, Home Assistant, Telegram,
Tauri/Flutter clients, or any cloud service. Those are separate, later
phases.

## Requirements

- Docker Desktop (macOS, Windows) or Docker Engine + Compose plugin (Linux)
- No local Node.js/Node-RED installation needed — everything runs in the
  container

## Start Node-RED

```sh
cd software/node-red
docker compose up -d
```

This works out of the box with built-in defaults; creating a `.env` file is
optional.

## Open the editor

```text
http://127.0.0.1:1880
```

The service is published on `127.0.0.1` (loopback) only. It is reachable
from this computer, not from other devices on the LAN.

> [!IMPORTANT]
> Do not change the published address to `0.0.0.0` without first adding
> authentication (Node-RED's `adminAuth`) and, for anything beyond local use,
> HTTPS. This first version intentionally has neither, because it is meant
> to be reached only from the local machine.

## Check status and logs

```sh
docker compose ps
docker compose logs -f node-red
```

## Stop Node-RED

```sh
docker compose stop
```

This stops the container but keeps it (and the `node-red-data` volume)
around, so `docker compose start` brings it back quickly.

To remove the container as well, while keeping all data:

```sh
docker compose down
```

`docker compose down` removes the container and network but **not** the
named volume — flows and credentials are preserved. To also delete all
Node-RED data (irreversible), you must explicitly remove the volume:

```sh
docker compose down -v
```

or `docker volume rm node-red_node-red-data`. Only do this if you actually
want to discard your flows.

## Restart

```sh
docker compose restart
```

## Where flows and credentials are stored

Node-RED's `/data` directory (flows, credentials, installed nodes, settings)
lives in the named Docker volume `node-red-data`, not on the host
filesystem. It survives container restarts, `docker compose down`, and
`docker compose up` as long as the volume itself isn't removed.

## Changing the port and timezone

Copy `.env.example` to `.env` and edit the values:

```sh
cp .env.example .env
```

```text
NODE_RED_PORT=1880   # host port the editor is published on (loopback only)
TZ=Europe/Rome        # container timezone
```

Apply changes with:

```sh
docker compose up -d
```

## After a computer restart

Docker Desktop does not restart stopped containers on its own unless it was
running when the machine shut down and its own "resume" setting is enabled.
The reliable way to bring Node-RED back up after a reboot is simply:

```sh
cd software/node-red
docker compose up -d
```

This is a no-op if the container is already running, and starts it
otherwise. The `restart: unless-stopped` policy will also keep the
container running/restarting across normal Docker Desktop or daemon
restarts, as long as you didn't explicitly stop it beforehand.

## Docker Desktop notes

- On first start, Docker Desktop must be running before `docker compose up
  -d` is executed.
- The bind is to `127.0.0.1`, which works the same way on Docker Desktop for
  macOS, Windows, and native Docker Engine on Linux.

## Spaghetti LAB branding

The [`theme/`](theme/) folder is a thin visual layer on top of stock
Node-RED — no forked image, no extra npm packages. It is organized in
tiers (subfolders); `compose.yaml` mounts whichever one `NODE_RED_THEME` in
`.env` points to (default: `safe`). See [`theme/README.md`](theme/README.md)
for the full explanation of the tier system and how to switch or add one.

The current `safe` tier ([`theme/safe/`](theme/safe/)):

- [`settings.js`](theme/safe/settings.js) is mounted read-only over
  `/data/settings.js`. It `require()`s the official image's own default
  settings file and overrides only the `editorTheme` section (page title,
  favicon, header logo, CSS, and a couple of end-user curation tweaks —
  e.g. non-developers can't install/remove palette nodes and break the
  instance). Every other setting — `flowFile`, `credentialSecret`,
  `uiPort`, logging, `functionGlobalContext`, and so on — keeps its normal
  stock Node-RED behavior.
- [`custom.css`](theme/safe/custom.css) overrides only the editor's
  documented, public CSS custom properties (`--red-ui-*`): the Spaghetti
  LAB blue accent, a system-font stack, softer shadows, and matching
  secondary/form colors. No internal/undocumented selectors are touched, so
  this tier is expected to keep working across Node-RED editor updates.
  The Deploy button's red/orange/gray states are deliberately left alone —
  they're a safety signal (unsaved changes), not a branding surface.
- `header-icon.png` and `favicon.ico` are cropped from the existing
  repository logo (`spaghetti-logo-blu.png`).

There is also a `deep` tier ([`theme/deep/`](theme/deep/)) with a more
"designed", app-like look — rounded corners, soft elevation shadows, pill
buttons, rounded flow nodes on the canvas. It builds on everything the
`safe` tier does, but additionally styles Node-RED's internal, undocumented
class names, so it can need a look after Node-RED editor upgrades in a way
`safe` doesn't. Full explanation and trade-offs in
[`theme/README.md`](theme/README.md).

To use it, set in `.env`:

```text
NODE_RED_THEME=deep
```

then `docker compose up -d`. To go back to the conservative default, set it
back to `safe` (or delete the line — `safe` is the built-in default) and
run `docker compose up -d` again. Either direction only swaps the mounted
theme files; flows, credentials, and installed nodes in the `node-red-data`
volume are never touched by switching tiers.

The whole `theme/` folder is mounted read-only, so nothing you do inside the
editor can modify these files; they are plain repository content, tracked
like any other file. Node-RED itself still owns `/data` (flows,
credentials, installed nodes) through the persistent `node-red-data` volume
described above.

To change colors, edit `theme/safe/custom.css` (or `theme/deep/custom.css`
if you're using that tier) and run `docker compose up -d` again — no
rebuild is needed since these are bind-mounted files, but Node-RED must be
restarted to reload `settings.js`.

## BLE gateway (Protocol V1)

Node-RED can talk to a Core over BLE without MQTT on the ESP32 by running the
host gateway documented in Firmware. See
[BLE_GATEWAY.md](BLE_GATEWAY.md) for the full runbook.

Quick path:

1. From `firmware/backbone`: `make host-tools`, then start
   `spaghetti-gateway serve --listen 127.0.0.1:8765` (key via
   `SPAGHETTI_BLE_KEY_FILE`, never argv).
2. Import
   `firmware/backbone/examples/node_red/spaghetti_ble_v1_flow.json` into this
   Node-RED instance.
3. Point the WebSocket client at `ws://127.0.0.1:8765/?token=…` and set the
   Core device id.

Binary WebSocket payloads are Protocol V1 CBOR envelopes (same as MQTT).

## Custom SpaghettiLAB nodes (S112/S112B)

`compose.yaml` bind-mounts `../micro-flow-editor/packages/node-red-nodes/dist-node-red`
into `/data/node_modules/@spaghettilab/node-red-nodes` — five real nodes (connection,
record source, command target, status, coordinator) built on the same Protocol V1 SDK
the React Flow app uses, not a separate implementation. They appear under the
"SpaghettiLAB" palette category once built.

Build them before starting (or after pulling changes to that package):

```sh
cd software/micro-flow-editor
docker compose run --rm micro-flow-editor npm run build:node-red -w @spaghettilab/node-red-nodes
```

Then `docker compose up -d` from this directory (or `docker compose restart node-red`
if it's already running) to pick up the bundle. See
[`../micro-flow-editor/packages/node-red-nodes/README.md`](../micro-flow-editor/packages/node-red-nodes/README.md)
for what each node does and what was/wasn't runtime-verified.

## Scope of this version

Included: a persistent, local-only Node-RED editor with basic Spaghetti LAB
branding (colors, logo, page title), plus docs for the Firmware BLE gateway
example flow.

Not included yet: MQTT broker, custom Spaghetti LAB nodes, dashboard UI, Home
Assistant integration, Telegram integration, Tauri/Flutter clients, cloud
services, remote/authenticated access. These will be introduced in later,
separate phases.

**Pianificato (formalizzato):** deployment turnkey on-prem, ruoli utente, Site
Package, auth Node-RED dietro host — vedi
[`../DEPLOYMENT_ACCESS_MODEL.md`](../DEPLOYMENT_ACCESS_MODEL.md) e task
[`E060`](../roadmap/ecosystem-access-v1/tasks/E060-nodered-auth-scoped-access.md).
