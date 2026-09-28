# Spaghetti LAB Module Tag Studio

Developer / manufacturing tool to read, compose, program, and verify ST25TN01K
module identity tags (protocol V1 `SLM1`).

Authoritative protocol: [`hardware/modules/nfc-tag/README.md`](../../hardware/modules/nfc-tag/README.md).

## Packages

| Package | Role |
|---|---|
| `@spaghettilab/module-tag-protocol` | SLM1 codec, CRC-32C, planners, executor |
| `@spaghettilab/module-tag-reader` | `NfcReader` + Simulated + Bringup adapters |
| `@spaghettilab/module-tag-registry` | Signed authority list, cache, definition resolve |
| `@spaghettilab/module-tag-audit` | Reports / NDJSON / CSV / HTML |
| `@spaghettilab/module-tag-studio-server` | Local HTTP bridge to `core_util.py --json` |
| `@spaghettilab/module-tag-studio-app` | Guided / Advanced / Batch UI |

## Quick start (simulated)

```sh
cd software/module-tag-studio
npm install
npm test
npm run dev
```

Open http://127.0.0.1:5180 — default adapter is **Simulated**.

## Hardware (bringup)

1. Flash / run bringup CORE+C3 with NFC (see `firmware/bringup/README.md`).
2. Start the reader server (uses argv-safe spawn, never shell concat):

```sh
cd software/module-tag-studio
npm run dev:server
```

3. In another terminal: `npm run dev`, switch reader to **Bringup**.
4. Optional: set `TAG_STUDIO_PYTHON`, `TAG_STUDIO_CORE_UTIL`, `TAG_STUDIO_READER_PORT`.

## Modes

- **Guided** — wizard with review, two-phase program, optional irreversible factory lock.
- **Advanced** — full page dump, decode JSON, lock/system pages read-only.
- **Batch** — shared definition, unique `module_instance_id`, CSV/JSON reports, resume.

## Tests

```sh
npm test
npm run test:golden
```

## Docs

- [ASSUMPTIONS.md](ASSUMPTIONS.md)
- [REMAINING.md](REMAINING.md)
- [docs/st25tn01k-lock-map.md](docs/st25tn01k-lock-map.md)
- [examples/jobs/](examples/jobs/)
