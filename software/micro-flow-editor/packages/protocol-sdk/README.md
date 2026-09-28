# @spaghettilab/protocol-sdk

CBOR codec for the firmware's Communication Protocol V1 (S021). Implements the
4-field envelope (`envelope.ts`), all 27 operations (`operations/`), the 4 event
payloads (`events.ts`), and the lossless 64-bit JSON rule (`int64.ts`), on top of a
hand-written canonical CBOR primitive layer (`cbor.ts`) matching exactly the subset
the firmware's zcbor encoder uses.

See `../../../roadmap/react-flow-v1/tasks/S021-codec-protocol-types.md` for the
implementation note. Two things worth knowing:

- The envelope now has a **real golden vector**, added to
  `firmware/backbone/tests/protocol/src/main.c` and verified by actually building and
  running that suite in `native_sim` — not just read from source. That run caught a
  real bug: this firmware's zcbor build encodes maps/arrays as **indefinite-length**
  (`0xBF...0xFF` / `0x9F...0xFF`), not canonical/definite-length as initially assumed
  from reading the C source alone. `cbor.ts` matches that now; the decoder accepts
  both forms.
- The 27 operations' payloads are still tested against **spec-conformant fixtures
  written for this package**, not firmware-published vectors — extending real golden
  vectors to each operation would mean wiring every handler into the firmware test,
  out of scope for this pass.

`SpaghettiClient` (S022) is implemented in `client/` — a transport-independent host
client covering all 27 operations, with replay-aware retry (same correlation ID on
every attempt of one logical call), an overall-deadline-vs-per-attempt-timeout split,
immediate (never auto-retried) surfacing of non-OK protocol statuses, reboot
detection via `STATUS` events that rejects in-flight calls rather than replaying
across a boot boundary, and fingerprint-aware catalog pagination that restarts from
scratch if the catalog changes mid-read. See
`../../../roadmap/react-flow-v1/tasks/S022-spaghetti-client-operations.md`.

Transport adapters (S023) live in `client/transports/`: `MqttProtocolTransport`,
`WebSocketProtocolTransport` (also covers a BLE gateway tunneled over WebSocket),
and `WebSerialProtocolTransport` (USB/serial, with a `StreamFrameDecoder` since a
byte stream has no message boundaries of its own) — all implement the same
`ProtocolTransport` interface `SpaghettiClient` already uses, verified to produce
identical decoded domain objects from the same golden envelope regardless of which
one carries it (`transports/__tests__/cross-transport-parity.test.ts`).
Safari has no Web Serial: React Flow keeps using `WebSocketProtocolTransport`
against `make usb-bridge` (`ws://127.0.0.1:8766`), which adds the USB length
prefix on the host. Do not send USB stream frames from the browser.

Event streaming (S024) is `client/event-stream.ts`'s `EventStream`: an async-iterable
stream of record/status/discovery/connectivity events over a `ProtocolTransport`,
with a bounded buffer (backpressure — the oldest event is dropped, never grown
without limit, and the drop count stays queryable) and explicit `gap` events for
both a reconnect (`boot_id_changed`) and a missed record sequence
(`sequence_discontinuity`) — never silently absorbed. `client/fakes/fake-event-fixtures.ts`
has deterministic builders (including a canned reboot scenario) for developing and
testing the rest of the app without a physical Core.

This closes the whole "Protocol SDK e trasporti" group (S021→S024).
