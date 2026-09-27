# Authenticated Wi-Fi OTA service

[← Services](../README.md) · [Public API](../../../include/spaghetti/ota.h) ·
[Architecture](../../../ARCHITECTURE.md)

OTA owns a short-lived DTLS-PSK server on UDP port 1337. It is initialized only in
Core `NORMAL` mode and opens only after consuming a locally provisioned one-shot
request. Initialization retains only bounded state. Start consumes the request; an
open window obtains its listener stack through the profile-bounded optional-thread
allocator, while timeout cleanup uses Zephyr's shared system workqueue. Stop closes
the socket, removes the network callback, joins the listener and returns its stack.
SMP buffers and the credential record remain bounded at build time. Zephyr's
network/TLS implementation uses the shared secure workspace and permits one DTLS
client session.

The service stores a 32-byte per-device PSK and a bounded identity in PSA ITS. Only an
active local Maintenance Link may set, clear or arm those credentials. The encrypted
ITS transform currently derives its key from the ESP32-C3 device ID; this protects
against accidental disclosure but is not a substitute for production Secure Boot and
flash encryption against physical extraction.

The transport feeds authenticated datagrams to Zephyr SMP but registers no generic
management groups. The existing Spaghetti group allows remote status, sequential
firmware chunks and cancellation. Config, Wi-Fi provisioning, bootstrap keys and OTA
credential changes remain local-only.

OTA never writes flash directly. It arms and assigns the global Update coordinator to
`SPAGHETTI_UPDATE_TRANSPORT_UDP`; Update owns image-1, the absolute deadline and the
MCUboot test marker. Timeout or Wi-Fi loss closes DTLS and discards the incomplete
candidate. A complete candidate is rebooted as trial and can still roll back.

SLUP on Backbone (`field_update.c`, `field_update_can.c`, `field_update_espnow.c`)
is a separate listen/send path. It uses `SPAGHETTI_UPDATE_TRANSPORT_CAN` and
`SPAGHETTI_UPDATE_TRANSPORT_ESPNOW` and does not open the DTLS socket or require
OTA credentials. The USB master discovers boards, puts one in load mode, and
pushes firmware over the CAN transceiver. See [`SLUP.md`](SLUP.md).
