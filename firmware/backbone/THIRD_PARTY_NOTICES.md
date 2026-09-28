# Third-party notices

This project builds firmware with third-party software. This file documents the
upstream material used by the default build environment; it does not change the
license of the original SpaghettiLAB source code.

## Zephyr Project

The firmware uses the [Zephyr Project RTOS](https://www.zephyrproject.org/),
version 4.4.0 by default.

- Upstream source: <https://github.com/zephyrproject-rtos/zephyr>
- Version used by this environment: `v4.4.0`
- Primary license: Apache License 2.0
- Local license copy: [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt)
- Upstream licensing information:
  <https://docs.zephyrproject.org/4.4.0/LICENSING.html>

Copyright and attribution notices in the Zephyr source and in its dependencies
remain the property of their respective owners.

## Zephyr modules and binary blobs

Zephyr uses modules maintained in separate repositories. Some imported or
reused components are licensed under terms other than Apache-2.0. The Docker
image also fetches Espressif binary blobs through `west blobs`; their applicable
license metadata is provided by the `hal_espressif` module.

The exact components included in a firmware image depend on its board and
Kconfig configuration. Before distributing a firmware binary or product:

1. Generate an SPDX SBOM for the final release build with `west spdx`.
2. Review the licenses and notices reported for Zephyr, modules, and blobs.
3. Ship all license texts and attribution notices that apply to the components
   present in that build, together with this notice and the Apache-2.0 text.
4. Preserve upstream notices in any third-party source files you redistribute,
   and clearly mark modifications to Apache-2.0-licensed files.

See Zephyr's official
[`west spdx` documentation](https://docs.zephyrproject.org/4.4.0/develop/west/zephyr-cmds.html#software-bill-of-materials-west-spdx)
for the full workflow. For this project, run the following inside `make shell`
(use a new build directory so the SPDX query is installed before CMake runs):

```sh
west spdx --init -d build-spdx
west build -b "$BOARD" -d build-spdx . -- -DCONFIG_BUILD_OUTPUT_META=y
west spdx -d build-spdx
```

The generated SPDX 2.3 documents are written to `build-spdx/spdx/`. Keep them
with the corresponding release records and use them to assemble the licenses
and notices shipped with that release.

This notice is provided for license-compliance assistance and is not legal
advice. The distributor remains responsible for reviewing the exact release
artifacts and satisfying all applicable third-party license terms.
