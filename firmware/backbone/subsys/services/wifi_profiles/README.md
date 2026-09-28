# Persistent Wi-Fi Profiles

[← Project README](../../../README.md) · [Architecture](../../../ARCHITECTURE.md)

Wi-Fi Profiles owns network credentials and automatic station selection. It is
separate from Module Config: changing an access point does not reconfigure Ports,
Modules, Runtime, or MQTT.

## Responsibilities

The service stores up to `CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT` fixed profiles,
keeps at most one preferred SSID, scans through Zephyr Wi-Fi management, and performs
all connection work in one lifecycle-owned worker. No password is exposed by the public list
or status API, logs, or shell output.

Selection is deterministic:

1. if the preferred stored SSID is visible, try it first;
2. otherwise try every visible known SSID by descending RSSI;
3. use SSID lexical order only to break equal-RSSI ties;
4. if association fails, try the next candidate and rescan after the bounded retry.

## Files and API

| File | Role |
|---|---|
| `include/spaghetti/wifi_profiles.h` | Public profile, summary, scan, state, and lifecycle contract. |
| `subsys/services/wifi_profiles/wifi_profiles.c` | Cache, scan callbacks, selection policy, and worker. |
| `subsys/services/wifi_profiles/wifi_profiles_storage.c` | Private PSA ITS record encoding. |
| `subsys/communication/communication_shell.c` | Serial provisioning commands. |
| `tests/wifi_profiles/` | Native CRUD and candidate-order tests. |

The set API borrows and copies a complete profile. The list API returns only SSID,
security, preferred/visible flags, and RSSI. Secret data is loaded into temporary
bounded storage only for a synchronous Zephyr connection request and is then wiped.

## Serial provisioning

Commands remain under the existing `spaghetti` shell root:

```text
spaghetti wifi scan
spaghetti wifi add "Office" wpa2
Password (input is hidden):
spaghetti wifi add "Guest" open
spaghetti wifi prefer "Office"
spaghetti wifi unprefer
spaghetti wifi list
spaghetti wifi connect
spaghetti wifi remove "Guest"
```

`spaghetti wifi scan` lists nearby access points (SSID, RSSI, security, and
whether a profile is already saved). It works in unprovisioned/offline mode and
does not connect. Use the printed security (`open` or `wpa2`) with `wifi add`.
Networks reported as `other` (for example WPA3) cannot be saved with the current
profile contract. At most eight strongest SSIDs are shown.

For WPA2, the password is read with `shell_readline()` while
`shell_obscure_set()` is active. It is not an argument of the command and therefore
does not enter shell history. These commands are intentionally preserved as a stable
serial provisioning path for the future application.

## Storage security

Profiles use Zephyr PSA Internal Trusted Storage with an AES-GCM transform, a random
nonce, and the existing Settings/NVS flash partition. AES-GCM provides confidentiality
and detects modified records. The current Zephyr 4.4 ESP32-C3 configuration derives
the key from the hardware device identifier. Zephyr explicitly warns that this
provider is not a hardware root of trust because a physical attacker may be able to
read or guess that identifier.

This is safer than plaintext Settings and prevents accidental credential disclosure
from ordinary flash inspection, but it is not the final production-security claim.
Production provisioning should replace the key provider with an ESP32-C3 eFuse HMAC
root and enable the product's verified-boot/debug policy. This firmware does not burn
eFuses automatically: provisioning them is irreversible and belongs in a separate,
explicit manufacturing procedure.

## Runtime behavior

Core initializes profiles after Settings and persisted Module Config are available.
Network callbacks only copy scan results, update atomics, and signal semaphores. The
worker performs scans, waits for association events, and retries; Shell, Runtime, and
MQTT never block on this policy. MQTT still waits for an IPv4 address and reconnects
through its existing behavior.

Initialization loads only persistent metadata. Connectivity Manager calls
`spaghetti_wifi_profiles_start()` to register callbacks and allocate the worker stack,
then calls `spaghetti_wifi_profiles_stop()` to disconnect, join the worker, remove the
callback, and return that stack. A stopped Wi-Fi service therefore retains profiles
but no optional worker resource.

In `UNPROVISIONED` and `MAINTENANCE`, Core instead calls
`spaghetti_wifi_profiles_init_offline()`. Profiles can still be added or removed by
the local maintenance protocol and are persisted with the same protection, but no
worker is started and `request_connect()` returns `-ENOTSUP`. A catalog scan is
still allowed so nearby networks can be listed before Normal mode.

`CONFIG_MAIN_STACK_SIZE=4096` is explicit because boot loads and authenticates PSA ITS
records from the main thread. The previous 2048-byte default was insufficient for the
ESP32-C3 crypto call chain and could corrupt the adjacent idle stack during boot.
