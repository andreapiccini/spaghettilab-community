# Firmware extension API V1

This public contract is the only supported entry point for additive downstream
firmware. An extension directory must contain:

- `spaghetti-extension.json`, declaring contract
  `spaghettilab.firmware-extension` and `api_version` `1`;
- `CMakeLists.txt`, loaded only after the manifest passes validation.

The manifest lists the exact public component API versions an extension may use.
Every linked descriptor must still carry its own API version; Community registries
reject incompatible module, rule, block, discovery and feature-pack descriptors.

An extension may add sources, include paths and iterable-section descriptors to the
existing Zephyr `app` target. It must not replace Community sources or make Community
depend on the extension. Removing `SPAGHETTI_FIRMWARE_EXTENSION_DIR` must restore the
complete standalone Community build.

Run the contract checks from the repository root:

```sh
python contracts/firmware-extension-v1/verify_contract.py
python firmware/backbone/tools/test_firmware_extension_contract.py
```
