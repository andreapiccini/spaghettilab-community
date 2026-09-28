# BLE Protocol V1 transport

Frozen wire contract for Communication Protocol V1 over Bluetooth Low Energy.
Envelope CBOR, correlation IDs, operations, and the central replay cache remain
owned by Protocol V1; this document freezes only the BLE adapter surface.

## Capability

`SPAGHETTI_BUILD_CAP_BLE` is set only when `CONFIG_BT` is selected for the
image. Runtime advertising still requires a successful `spaghetti_ble_start()`
(`bt_enable()`, GATT registration, and advertising). Core V1 ships two artifacts:
the default Wi-Fi image leaves `CONFIG_BT` off; `make build-ble` selects it and
drops Wi-Fi. Do not enable both in one binary on this SRAM budget.

## GATT UUIDs

```text
service  53504748-4554-5449-4c41-420000000001
request  53504748-4554-5449-4c41-420000000002  write
response 53504748-4554-5449-4c41-420000000003  indicate
event    53504748-4554-5449-4c41-420000000004  notify
```

## Link security

- LE Secure Connections and bonding are required when the BT stack is available.
- Just Works pairing alone never authorizes Protocol operations.
- Application authorization uses a Maintenance-provisioned 32-byte key in PSA ITS.

## Application authentication

After ATT connection the firmware notifies one challenge on the event
characteristic:

| Offset | Size | Field |
|---:|---:|---|
| 0 | 1 | `0x01` challenge type |
| 1 | 4 | `session_id` little-endian |
| 5 | 32 | random `nonce` |

The client writes one proof on the request characteristic before any framed
Protocol envelope:

| Offset | Size | Field |
|---:|---:|---|
| 0 | 1 | `0x02` proof type |
| 1 | 2 | `credential_id` little-endian |
| 3 | 32 | `HMAC-SHA256(nonce \|\| device_id \|\| session_id)` |

`device_id` is the 32-byte public identity from Identity. The credential resolves
the principal provisioned in Access Control. Adapter permissions are the
intersection of that principal and the BLE maximum
(`READ | CONFIGURE | COMMAND | DISCOVER`). Revoking the principal closes the
matching BLE peer immediately.

## Request / response framing

Protocol envelopes are fragmented with an 8-byte little-endian header followed
by payload bytes:

| Offset | Size | Field |
|---:|---:|---|
| 0 | 4 | `message_id` |
| 4 | 2 | `offset` |
| 6 | 2 | `total` |
| 8 | N | payload fragment |

Rules:

- Absolute envelope maximum is 2048 bytes (`total`).
- One in-flight reassembly per peer.
- Overlap, `total` over the limit, reassembly timeout, and a second distinct
  `message_id` while a reassembly is open are rejected (`rx_rejected`).
- Exact duplicate fragments for the open `message_id` may be ignored.
- Complete requests decode as Protocol V1 CBOR and enter
  `spaghetti_communication_handle_request`.
- Responses are indicated on the response characteristic using the same framing.
- The adapter does not own a second replay cache.

## Events

Authenticated peers receive Protocol events as notify frames on the event
characteristic using the same framing. Notify credit is bounded; excess events
increment `event_dropped` and do not advance other record consumers.

## Record Delivery

Consumer ID `SPAGHETTI_RECORD_CONSUMER_ID_BLE` (`spaghetti_ble_record_consumer`)
is activated only after application authentication and deactivated on
disconnect. BLE ACKs never advance the MQTT cursor.
