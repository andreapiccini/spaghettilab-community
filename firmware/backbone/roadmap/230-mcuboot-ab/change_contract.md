# Change contract: MCUboot A/B build chain

## Scope

- Task: build MCUboot and Spaghetti LAB together with signed A/B images.
- Required observable outcome: sysbuild produces a bootloader, a signed application,
  and a complete flash artifact using the existing fixed partitions.
- Explicitly excluded behavior: receiving an image, selecting test boot at runtime,
  confirming an image, OTA transport, eFuse programming, and production Secure Boot.
- Component that owns the change: host build system.
- Files allowed to change: sysbuild configuration, application Kconfig, Makefile,
  host flash helper, ignored-key policy, and documentation.

## API

- Public function name: none.
- Public header, or reason the function remains private: no runtime API is introduced.
- Return type and why it matches the guide: build commands use process exit status.
- Success value: zero process status and all expected artifacts present.
- Expected errors: missing key, invalid key, Kconfig conflict, image overflow, signing
  failure, or flash runner failure must stop the command.
- Idempotent: builds are repeatable; key generation refuses to replace an existing key.

## Data and ownership

- New mutable object: local ECDSA P-256 development private key.
- Owner: developer/release environment, never firmware runtime.
- Lifetime: across builds until deliberately rotated and devices are reprovisioned.
- Maximum count/capacity: one development signing key for this workspace.
- Static allocation, fixed pool, or justified dynamic allocation: not applicable.
- State after failure: existing key and last successful firmware artifacts are not
  overwritten by the key-generation command.

## Execution

- Invocation context: host build process.
- Can sleep or block: Docker build, compiler and signing tools may block normally.
- Direct call, work item, message queue, zbus, or dedicated thread: not applicable.
- Log module owner: not applicable.

## Configuration and hardware

- Devicetree fact required: the existing 4 MiB map provides boot, image-0, image-1,
  storage and scratch without overlap.
- Kconfig feature required: MCUboot, ECDSA P-256, swap-using-move and downgrade
  prevention.
- Runtime Config value required: none.
- CMake source/directory change required: sysbuild wraps the existing application;
  application source selection remains unchanged.

## Verification

- Success test: pristine sysbuild completes and creates signed and merged artifacts.
- Invalid-input test: building without the private key fails before configuration.
- Boundary test: application and MCUboot fit their fixed partitions.
- Dependency-failure test: an invalid PEM makes signing fail.
- Rollback/state test: mode configuration is swap-using-move, not overwrite-only;
  runtime rollback is exercised in task 250.
- Build command: `make pristine`.
- Hardware test: first full provisioning is intentionally left for the user because it
  overwrites the boot chain and requires the connected board.
- Formatting/static checks performed: validator, roadmap validator and diff check.
