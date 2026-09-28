# Change contract: transport-independent Update coordinator

## Scope

- Task: own one bounded update session across local UART and authenticated UDP.
- Observable result: legal state transitions, timeout cleanup and MCUboot test request.
- Excluded: transport framing, receiving bytes, reboot, trial health and confirmation.
- Owner: `subsys/services/update` for application lifetime.

## API and ownership

- Public API: `include/spaghetti/update.h`; all functions are synchronous thread calls.
- `timeout_ms` is a copied non-zero duration covering arm through finish.
- Transport is a small enum passed by value; exactly one non-NONE value owns a session.
- Status is copied to caller-owned `out` only on success; no pointer is retained.
- State, deadline and transport are static and mutex-protected; timeout uses one
  delayable work item on a statically allocated component-owned workqueue. No heap,
  image buffer, credential or URL is retained.
- Backend operations are private synchronous calls selected at build time. Tests supply
  a fake; Core V1 uses Zephyr flash-map and MCUboot APIs.

## Failure and rollback

- Invalid transitions preserve the current owner and state.
- Preparation failure enters ERROR without claiming RECEIVING.
- Timeout and cancel erase only the upload slot and release the transport after success.
- Cleanup failure enters ERROR and retains its errno for a retry through `cancel()`.
- Finalization checks the public MCUboot header and requests only
  `BOOT_UPGRADE_TEST`; MCUboot verifies ECDSA before execution after reboot.
- Initialization never erases image-1 because it may contain the rollback image during
  a trial boot.

## Verification

- Native fake tests: pre-init, invalid values/transitions, competing transports,
  preparation/finalization failures, pending cancel and timeout cleanup.
- Production build: sysbuild with MCUboot ECDSA P-256 and swap-using-move.
- Static checks: validator, roadmap validator and `git diff --check`.
