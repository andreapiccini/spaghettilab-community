# Communication

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md)

Communication Protocol V1 is transport-independent. Adapters (USB Shell, Remote
Console, and future MQTT/BLE) build `spaghetti_protocol_request` envelopes and
call `spaghetti_communication_handle_request()` with an authenticated
`spaghetti_request_context`.

## Contracts

`contracts/protocol-v1/manifest.json` defines the canonical operation IDs 1–31,
public status codes and capability negotiation contract. The C declarations in
`include/spaghetti/protocol.h` are verified against it and define canonical CBOR
envelopes, event codecs, and iterable operation handlers.
`include/spaghetti/communication.h` exposes init, dispatch, and session
invalidation hooks.

```c
int spaghetti_communication_handle_request(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_request *request,
	struct spaghetti_protocol_response *response);
```

Dispatch validates the envelope, authorizes the principal against the handler
requirements and adapter-capped permissions, consults the replay cache, then
runs immediate reads, serialized mutations, or async jobs. Public status is
mapped from errno by `spaghetti_protocol_status_from_errno()`.

## Replay, mutations, and jobs

- Replay cache key: `principal_id + correlation_id`
- Same request bytes → cached response; different bytes/op → CONFLICT
- TTL: `CONFIG_SPAGHETTI_PROTOCOL_REPLAY_WINDOW_MS`
- Capacity: `CONFIG_SPAGHETTI_MAX_INFLIGHT_REQUESTS`
- Mutations run on a Communication worker, never inside MQTT/BLE callbacks
- Async jobs return `job_id`; poll with `GET_JOB_STATUS`

## Adapter policies

| Adapter | Max permissions |
|---|---|
| USB Shell (Maintenance/Unprovisioned) | all |
| USB Protocol V1 (same UART, framed) | same as USB Shell |
| USB Shell (Normal) | read\|configure\|command\|discover\|update |
| Remote Console TLS | read\|configure\|command\|discover (never provision) |

USB Protocol V1 uses kind + big-endian length + envelope on Serial/JTAG. The
Shell stays available when the host is a terminal. One host program owns the
port at a time. Safari has no Web Serial; `make usb-bridge` exposes the same
port on `ws://127.0.0.1:8766` with React Flow's WebSocket framing.

Shell and Remote Console keep human commands (`spaghetti status`,
`spaghetti apply <hex>`) but construct Protocol V1 requests internally.

## Operations

See [operations/README.md](operations/README.md).
