# Spaghetti LAB update qualification report

**Result:** NOT QUALIFIED — hardware cases have not been executed

## Candidate

Copy the complete JSON produced by `make update-qualification-manifest` here before
testing. A releasable candidate requires `git_dirty: false`, no tracked secret
candidates, and no unsafe private-file modes.

```json
{
  "status": "NOT CAPTURED"
}
```

| Field | Value |
|---|---|
| Board revision | NOT RECORDED |
| Device serial | NOT RECORDED |
| Zephyr | 4.4.0 |
| MCUboot | NOT RECORDED |
| Base/client hardware and revision | NOT RECORDED |
| Base/client firmware/tool version | NOT RECORDED |
| Controllable power fixture | NOT RECORDED |
| Test date and operator | NOT RECORDED |

## Evidence rules

For every case, Evidence must name a committed log or measurement under this
directory and include the before/after application version, active slot, MCUboot swap
type, confirmed flag, Update state, Config generation/presence and observed recovery reason. Never
store PSKs, Wi-Fi passwords, private signing keys or raw shell history here.

Allowed statuses are `PASS`, `FAIL`, `N/A`, and `NOT RUN`. `N/A` requires a concrete
hardware reason in Evidence; it is not a substitute for an unavailable fixture.

## Transfer and candidate validation

| ID | Transport | Action | Expected result | Status | Evidence |
|---|---|---|---|---|---|
| Q-U01 | UART | Upload the complete signed candidate and send the final command. | Candidate boots once as trial, passes health checks, then becomes confirmed. | NOT RUN | - |
| Q-U02 | UART | Corrupt MCUboot magic/header before upload. | Candidate never executes; the confirmed image remains bootable. | NOT RUN | - |
| Q-U03 | UART | Flip one payload byte without changing the signed hash. | MCUboot rejects the candidate and boots the confirmed image. | NOT RUN | - |
| Q-U04 | UART | Sign with an untrusted key. | MCUboot rejects the signature and boots the confirmed image. | NOT RUN | - |
| Q-U05 | UART | Declare/send one byte beyond reported image-1 capacity. | SMP rejects the transfer before out-of-slot write; active image and Config are unchanged. | NOT RUN | - |
| Q-U06 | UART | Upload a correctly signed lower security/version candidate. | MCUboot downgrade policy rejects it; confirmed image remains active. | NOT RUN | - |
| Q-W01 | Wi-Fi | Arm OTA locally, upload the complete signed candidate over DTLS, then finalize. | Same trial and confirmation result as Q-U01; listener closes after use. | NOT RUN | - |
| Q-W02 | Wi-Fi | Repeat invalid header, payload hash and untrusted-signature candidates. | Every variant is rejected; none executes or changes Config. | NOT RUN | - |
| Q-W03 | Wi-Fi | Declare/send one byte beyond reported image-1 capacity. | Request is rejected and no out-of-slot write occurs. | NOT RUN | - |
| Q-W04 | Wi-Fi | Upload a correctly signed prohibited downgrade. | MCUboot rejects it and retains the confirmed image. | NOT RUN | - |

## Interrupted transfer and power

For Q-U07 and Q-W05, run and record all seven boundaries separately: 0%, 1%, 25%,
50%, 99%, after the final data chunk but before finalize, and immediately before the
final command leaves the client.

| ID | Transport | Action | Expected result | Status | Evidence |
|---|---|---|---|---|---|
| Q-U07 | UART | Disconnect at every defined transfer boundary and let the absolute deadline expire. | Incomplete image-1 is discarded; confirmed image boots; Config is preserved. | NOT RUN | - |
| Q-W05 | Wi-Fi | Drop DTLS/network at every defined transfer boundary. | Listener closes, Update cancels, incomplete image-1 is discarded. | NOT RUN | - |
| Q-U08 | UART | Cut power while a middle chunk is being written. | Next boot selects the confirmed image; a new local recovery upload can begin. | NOT RUN | - |
| Q-W06 | Wi-Fi | Cut power while a middle chunk is being written. | Same recovery as Q-U08; no automatic OTA listener opens without a new marker. | NOT RUN | - |
| Q-C01 | Common | Cut power immediately before `BOOT_UPGRADE_TEST` is persisted. | Old confirmed image boots and candidate is not treated as trial. | NOT RUN | - |
| Q-C02 | Common | Cut power immediately after `BOOT_UPGRADE_TEST` is persisted. | Candidate boots as trial or MCUboot safely retains the old image; both slots are not lost. | NOT RUN | - |
| Q-C03 | Common | Reboot after all bytes but before finalize. | Old confirmed image boots; incomplete/pending data does not execute. | NOT RUN | - |
| Q-C04 | Common | Reboot after finalize and before application confirmation. | Candidate is trial and remains rollback-capable. | NOT RUN | - |

## Trial boot and rollback

Use a test candidate built separately for each injected failure. Do not expose a
remote command that confirms the trial image.

| ID | Transport | Action | Expected result | Status | Evidence |
|---|---|---|---|---|---|
| Q-T01 | Common | Crash the candidate before the health window completes. | Next MCUboot cycle reverts to the previously confirmed image. | NOT RUN | - |
| Q-T02 | Common | Deadlock the candidate before confirmation, then reset it with the fixture. | MCUboot reverts; the failed candidate never becomes confirmed. | NOT RUN | - |
| Q-T03 | Common | Let the watchdog reset the candidate before confirmation. | MCUboot reverts and reports the old confirmed version/slot. | NOT RUN | - |
| Q-T04 | Common | Let a healthy candidate survive the configured health window. | Core alone confirms it; subsequent reset keeps the new image. | NOT RUN | - |

## Boot mode, Config, and local recovery

| ID | Transport | Action | Expected result | Status | Evidence |
|---|---|---|---|---|---|
| Q-B01 | Common | Erase Config while leaving firmware and credentials intact, then boot. | Mode is Unprovisioned; UART Maintenance is active; Runtime, Wi-Fi, OTA and remote console stay off. | PASS | Core V1 `90:70:69:ad:75:48` 2026-08-14. Settings partition erased (firmware slots untouched). Boot: `config=absent`, `mode=unprovisioned`, `maintenance_link active reason=0`, no Runtime/MQTT/OTA start. `spaghetti status` core=3 RUNNING, wifi `state=idle profiles=0`, remote-console uninitialized. |
| Q-B02 | Common | Install a Config record with invalid integrity/version, then boot. | Corruption is reported and no unsafe automatic upload or operational start occurs. | NOT RUN | - |
| Q-B03 | Common | Inject a temporary Storage read failure at boot. | Core fails closed; it does not start Runtime or a network update listener. | NOT RUN | - |
| Q-B04 | UART | Boot valid Config with no bootstrap key and send no frame. | Receive-only bootstrap window expires and Port ownership returns to normal operation. | NOT RUN | - |
| Q-B05 | UART | Send malformed and wrong-HMAC bootstrap frames during the window. | Frames are rejected; TX is not enabled and normal operation resumes. | NOT RUN | - |
| Q-B06 | UART | Send the valid device-bound bootstrap frame during the window. | Core enters local Maintenance without starting Runtime or network services. | NOT RUN | - |
| Q-B07 | USB | Request `spaghetti maintenance reboot`, reset again after entering Maintenance, then boot normally. | Marker is consumed once; no Maintenance boot loop occurs. | NOT RUN | - |
| Q-B08 | UART | With USB physically disconnected, recover by uploading a valid signed image from the base. | Core returns to a healthy confirmed image using only final-product pins. | NOT RUN | - |

## Network isolation and credentials

| ID | Transport | Action | Expected result | Status | Evidence |
|---|---|---|---|---|---|
| Q-N01 | Wi-Fi | Remove Wi-Fi during an active OTA transfer. | DTLS closes and Update discards only the incomplete secondary image. | NOT RUN | - |
| Q-N02 | Wi-Fi | Disconnect the authenticated remote console during OTA. | OTA ownership and Runtime remain coherent; console loss cannot confirm or alter the candidate. | NOT RUN | - |
| Q-N03 | Wi-Fi | Try wrong OTA PSK, wrong console PSK, and a second console client. | Authentication fails; no firmware bytes, status or administrative command cross the wrong session. | NOT RUN | - |
| Q-N04 | Wi-Fi | Boot normally without the OTA one-shot marker. | UDP 1337 is closed even when credentials and Wi-Fi are present. | NOT RUN | - |

## Secret and production-path audit

| ID | Transport | Action | Expected result | Status | Evidence |
|---|---|---|---|---|---|
| Q-S01 | Host | Run manifest checks and inspect committed files/artifacts. | No private signing key, PSK or Wi-Fi password is tracked or published. | PASS | 2026-08-14 host scan on `firmware/backbone`: `tracked_secret_candidates=[]`, `unsafe_private_file_modes=[]`. Full `update-qualification-manifest` not captured (working tree dirty with firmware stack fixes). |
| Q-S02 | UART/USB | Provision credentials while capturing logs and command history. | Secret input is hidden and no plaintext secret appears in logs/history. | NOT RUN | - |
| Q-S03 | Common | Exercise initial USB provisioning, local update, Wi-Fi OTA, base recovery and documented factory recovery separately. | Each path has distinct authorization and preserves at least one bootable image. | NOT RUN | - |
| Q-S04 | Wi-Fi | Attempt Config, key, Wi-Fi and image-confirm operations through the remote console and OTA transport. | Restricted parsers reject every operation outside their documented boundary. | NOT RUN | - |

## Final decision

- [ ] Every row has a final result and attached evidence.
- [ ] Every required row is `PASS`; each `N/A` has approved hardware justification.
- [ ] The tested hashes equal the frozen candidate manifest.
- [ ] No case left both image slots unbootable.
- [ ] Config and credentials remained coherent after interruption and rollback.
- [ ] Recovery through final-product pins worked with USB disconnected.
- [ ] A reviewer independent from the operator approved the evidence.

**Release decision:** NOT APPROVED

**Operator:** NOT RECORDED  
**Reviewer:** NOT RECORDED  
**Date:** NOT RECORDED
