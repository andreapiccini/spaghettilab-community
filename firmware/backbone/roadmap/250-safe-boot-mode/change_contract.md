# Change contract: safe boot policy and trial confirmation

## Scope

- Task: derive one operational mode and expose the independent MCUboot image state.
- Observable result: boot log and status report mode, image, slot, confirmation and
  signed version.
- Excluded: shared-pin UART pinmux, maintenance framing, image transport and watchdog
  qualification; phases 260 and 290 own those items.

## State, ownership and policy

- Core owns `UNPROVISIONED`, `NORMAL` or `MAINTENANCE` for one boot.
- Update/MCUboot own whether the running image is `TRIAL` or `CONFIRMED`.
- Core information is static; callers receive a bounded copy and no pointer is retained.
- Config absence or invalidity selects UNPROVISIONED. A valid Config plus a consumed
  marker or accepted bootstrap probe selects MAINTENANCE; otherwise it selects NORMAL.
- Only NORMAL starts Runtime, MQTT, Discovery and Wi-Fi Profiles. Communication remains
  available in every mode.

## Persistence and failure

- The maintenance marker is a one-byte Settings value outside Config. Storage deletes
  it before reporting the request, preventing repeated maintenance boots.
- Trial confirmation is legal only after Core reaches RUNNING and survives the bounded
  health window.
- Confirmation failure sets Core FAILED and warm-reboots without marking the image
  permanent. Reset or crash before confirmation leaves rollback metadata intact.
- All state is statically allocated; no heap is introduced.

## Verification

- Native Core scenarios: normal, missing Config, marker, bootstrap and trial.
- Storage tests: absent marker, one-shot consumption and delete failure.
- Update tests: slot reporting, illegal confirmation and successful trial confirmation.
- Communication test: complete copied boot status.
- Production build: MCUboot sysbuild, application signature, slot lookup and reboot API.
