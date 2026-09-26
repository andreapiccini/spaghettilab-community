# Micro Flow Editor

A Docker Compose environment running a [React](https://react.dev/) +
[Vite](https://vite.dev/) app with [React Flow](https://reactflow.dev/)
(`@xyflow/react`) wired up — plus the npm workspace of ~25 backend packages
(`packages/*`, S011 onward) the app itself is now being built on top of
(`roadmap/app-v1`, starting with `UI-S010`).

`packages/app` today has a real Project/Workspace shell (create/open/import a
Project, undo/redo, `⌘K` command palette) and live Core Connections: Auto /
rete / via cavo, identity from Protocol V1 `GET_STATUS`, Web Serial on
Chrome/Edge, and Safari via the USB bridge started by `make up-d`. Remaining
`roadmap/app-v1` screens that are not implemented yet stay honest placeholders
(Device Profile Studio, Processing Graph Editor, Deploy & Diff, Runtime &
Diagnostics, Capability Marketplace, Cross-Core Automation, Settings). See
`roadmap/app-v1/README.md` and `UX_ARCHITECTURE.md`/`ux/screens/`.

## Why this exists

Node-RED (see [`../node-red`](../node-red)) stays the server-side engine —
MQTT, integrations, automation logic that runs continuously on the host.
This app is for a different job: a purpose-built editor for describing
device behavior as a block graph that gets *compiled* into a config the
firmware runs on its own, independent of whether the server is even
reachable. React Flow was chosen over reshaping Node-RED's own canvas
because Node-RED's editor isn't built to be replaced at that level (see the
project discussion this came out of) — full write-up pending in a future
architecture doc.

The complete functional architecture and implementation backlog now live in:

- [`../REACT_FLOW_ARCHITECTURE.md`](../REACT_FLOW_ARCHITECTURE.md)
- [`../roadmap/react-flow-v1/README.md`](../roadmap/react-flow-v1/README.md)

They deliberately specify no visual design. The current source remains only the
running technical prototype until those tasks are implemented.

## Workspace layout

npm workspace with one package per architectural boundary from
`REACT_FLOW_ARCHITECTURE.md`:

```text
packages/
  domain/               pure TypeScript domain kernel — no React, no React Flow,
                         no browser API (enforced by having no such dependency).
                         ProjectV1 schema/migrations/commands, branded IDs, graphs,
                         connection profiles, permission matrix, sandboxed import/
                         export, audit guard, plus abstract infrastructure ports
                         (clock, UUID, storage, credentials, logger, audit) with an
                         in-memory/deterministic fake for each (S011-S014, S121-S123).
  protocol-sdk/          Protocol V1 CBOR codec, SpaghettiClient, MQTT/WebSocket/
                         WebSerial transport adapters, event streaming with
                         backpressure/gap signaling (S021-S024).
  core-session/          Device Session Manager — per-Core session state machine,
                         sync classification, catalog cache, discovery binding
                         (S030).
  catalog-model/         Catalog/topology normalization — immutable, order-
                         independent indices for Module Drivers, Profiles,
                         Capability Packs and Flow/Bay/Port/rail (S041).
  editor-model/          EditorModel, form model and compatibility engine —
                         node types, typed form fields, handle/edge
                         compatibility checks, unknown-type placeholders (S042).
  project-store/         ProjectV1 persistence: repository + transactional
                         autosave/history/concurrency (S014, S122).
  react-flow-adapter/     bidirectional Domain <-> React Flow adapter (S043)
  physical-composition-model/ Backbone/Power/Bay/Connector/external-device/Module
                           node data, topology-backed validation, Module-discovery
                           preview/diff (S050).
  device-profile-authoring-model/ Declarative Device Profile authoring model —
                           typed acquisition-plan instructions, budget validation,
                           sourced from the firmware's own opcode/struct
                           definitions (S061).
  device-profile-package/ Canonical Device Profile package import/export and an
                           install-feasibility resolver (READY/PROFILE_INSTALL_
                           REQUIRED/FIRMWARE_UPDATE_REQUIRED/HARDWARE_INCOMPATIBLE/
                           RESOURCE_INCOMPATIBLE/VERSION_CONFLICT) (S062).
  device-profile-install/ Real Device Profile wire CBOR encoder/decoder, remote
                           install/remove workflow with post-install hash
                           verification, catalog source merge, Module
                           instantiation (S063).
  device-processing-graph-model/ Schedule/Event source/Block/Rule authoring
                           model and graph validation (cycles, dangling
                           references, type/unit checks, cross-Core rejection)
                           for one Core's local processing behavior (S071).
  processing-block-catalog/ Host catalog of functional blocks: AppBlocks
                           Library mapped onto firmware node kinds, plus
                           native Block Drivers, with explicit Node-RED /
                           Features / out-of-scope rows (S074).
  config-compiler/        Deterministic Config compiler — stable key
                           assignment, real wire-V3 CBOR encoding, canonical
                           JSON, reproducible SHA-256 hash, budget checks with
                           node-level ownership attribution (S072).
  config-decompiler/      Config CBOR decoder, Config -> authoring graph
                           decompiler (never inventing unrecoverable
                           metadata), and a full local dry-run with
                           errors/warnings collected, never fail-fast (S073).
  config-deployment/      Transactional Config deploy — compile, dry-run,
                           remote validate, compare-and-swap apply, read-back
                           verify, semantic diff, structured conflict
                           handling, independent multi-Core results (S080).
  telemetry-buffer/       Bounded per-(Core, schema) telemetry buffers from
                           EventStream traffic, with explicit boot-epoch/gap
                           tracking and unknown-schema preservation (S091).
  core-actions/           Immediate Module commands and discovery scan/job
                           orchestration, kept structurally separate from
                           Config, with permission-denied/queue-full/timeout
                           as distinct outcomes (S092).
  core-status/            Readable Module/schedule/Rule/Block/service/
                           connectivity/health/reset-cause/watchdog/audit/job
                           status and a resource monitor with flash/RAM/pool
                           figures kept distinct, never summed (S093).
  core-admin/             Connectivity lease, network maintenance and
                           factory-reset scope, each gated by a local
                           permission check and (for destructive ones) an
                           explicit target-matching confirmation before any
                           wire call (S094).
  capability-marketplace/ Capability Pack marketplace catalog, installed-vs-
                           required-vs-available distinction, and a
                           deterministic dependency resolver with an explicit
                           reason for every selection/conflict (S101).
  ota-preflight/          Local, pre-transfer OTA candidate preflight (trust,
                           hash, compatibility, budget with explicit deltas)
                           and deterministic all-supported/composed build
                           selection among already-signed images (S102).
  ota-lifecycle/          BLE OTA state machine, postflight verification
                           (device ID/version/feature-set/Config/profile),
                           S030 catalog-cache invalidation and audit — never
                           marks "installed" without every check passing
                           (S103).
  system-automation-graph/ Cross-Core link representation — device ID +
                           stable key endpoints (never a runtime session
                           id), a type/unit compatibility engine that
                           requires an explicit transformation instead of
                           converting implicitly, and fingerprint-based
                           staleness (S111).
  node-red-nodes/         Real SpaghettiLAB Node-RED nodes — connection,
                           record source, command target, status,
                           coordinator — reusing core-actions/core-status/
                           telemetry-buffer/system-automation-graph directly
                           rather than a parallel implementation (S112).
  node-red-deploy/        Compiles the System Automation Graph into a real
                           Node-RED flow, deploys it via the real Admin API
                           with compare-and-swap and ownership-scoped
                           reconciliation, classifies IN_SYNC/DIVERGED like
                           Config, and dedupes retried records so a command
                           never fires twice (S113).
  security-recovery/      Target-specific destructive confirmation (device
                           ID/scope/consequence), guided recovery plans for
                           six failure scenarios, retention/purge policy, and
                           an automated threat-test suite covering XSS,
                           malicious profiles, oversized imports, forged
                           marketplace metadata and secret leakage (S124).
  app/                    the React Flow canvas prototype (this is what you see
                           at http://127.0.0.1:5173)
```

Each package has its own `package.json`, `tsconfig.json` (extending the shared
`tsconfig.base.json`, TypeScript strict), and — except `app`, which is the Vite
entry point — its own `vitest.config.ts`.

## Requirements

- Docker Desktop (macOS, Windows) or Docker Engine + Compose plugin (Linux)
- No local Node.js installation needed — everything runs in the container

## Start it

```sh
cd software/micro-flow-editor
make up-d
```

That starts the host USB bridge (`127.0.0.1:8766`) and then Docker Compose.
Safari never opens that port itself: React Flow proxies `/usb-bridge` from
`http://127.0.0.1:5173`. `docker compose up -d` alone does not start the
bridge: Docker on macOS cannot open `/dev/cu.usbmodem*`. Close `make monitor`
first. Chrome can keep using Web Serial without the bridge.

First start builds the image (installs npm dependencies inside the
container) and can take a minute or two. Subsequent starts are fast.

```sh
make down    # stop the editor and the USB bridge
```

## Open the editor

```sh
make open
```

Starts `make up-d` if the Vite server is not already listening, then opens
`http://127.0.0.1:5173` in the default browser. Same path via `npm run open`
when Node is available on the host.

```text
http://127.0.0.1:5173
```

Visitor demo (Processing Graph only, English, no Core required):

```text
http://127.0.0.1:5173/?demo=1
```

That URL rebuilds the shipped Schedule → Digital Out Toggle → LED graph,
skips the project picker / tour / Core Connections, and auto-runs a local
LED preview. Click a block to change settings. A production build can lock
the same mode with `VITE_DEMO_ONLY=1` (`base: './'` is already set for a
later GitHub Pages deploy).

Published on `127.0.0.1` (loopback) only, same policy as the Node-RED
environment — reachable from this computer, not from other devices on the
LAN. Electron/Tauri are not wrapped yet: the app uses Web Serial and the
Docker Vite workflow, so a native shell would slow development.

## Development workflow

Source code (`packages/*/src`, `packages/app/index.html`, config files) is
bind-mounted into the container, and the Vite dev server watches
`packages/app` — edit files on the host with your normal editor, save, and
the browser hot-reloads. `node_modules` lives in its own named Docker volume
(`micro-flow-editor-node-modules`) — npm workspaces hoist every package's
dependencies into this single root `node_modules` (with symlinks for the
local `@spaghettilab/*` packages), kept separate from the host filesystem so
host/container platform differences (e.g. native dependencies) don't
collide.

Adding or updating a dependency (any `package.json` change) requires
rebuilding the image so `npm install` re-runs:

```sh
docker compose up -d --build
```

## Quality checks

Every command below runs across the whole workspace (all packages), inside
the container, without needing Node installed on the host:

```sh
docker compose run --rm micro-flow-editor npm run lint
docker compose run --rm micro-flow-editor npm run typecheck
docker compose run --rm micro-flow-editor npm run test
docker compose run --rm micro-flow-editor npm run test:coverage
docker compose run --rm micro-flow-editor npm run build
```

Or all four in sequence (the CI entry point — reproducible from a clean
checkout, no manual steps beyond `docker compose build`):

```sh
docker compose run --rm micro-flow-editor npm run ci
```

## Check status and logs

```sh
docker compose ps
docker compose logs -f micro-flow-editor
```

## Stop it

```sh
docker compose stop
```

Keeps the container and the `node_modules` volume. To remove the
container too (volume still preserved):

```sh
docker compose down
```

To also wipe the installed-dependencies volume (forces a clean reinstall
next start):

```sh
docker compose down -v
```

## Changing the port

Copy `.env.example` to `.env` and edit:

```sh
cp .env.example .env
```

```text
MICRO_FLOW_EDITOR_PORT=5173
```

Then `docker compose up -d`.

## Scope of this version

**Backend** (`roadmap/react-flow-v1`, S011–S124): all ~25 packages listed above are
implemented and tested — domain types, the three graphs, Protocol V1 SDK, Core
sessions, catalog/topology, physical composition, Device Profile authoring/install,
the processing graph and Config compiler/decompiler/deployment, telemetry, admin
operations, the Capability Pack marketplace and OTA lifecycle, the System Automation
Graph, real Node-RED nodes and Admin API deploy, and security/recovery. S130 (the
final end-to-end gate) is not yet closed — it requires the UI work below.

**UI** (`roadmap/app-v1`, new): `packages/app` is being rebuilt against
`UX_ARCHITECTURE.md`'s design specification, screen by screen, on top of the backend
above. `UI-S010` (Project/Workspace shell) is done; the other ten screens are honest
placeholders naming the task that will implement them — see `roadmap/app-v1/README.md`.
