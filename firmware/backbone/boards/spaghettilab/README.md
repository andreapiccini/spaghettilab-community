# Spaghetti LAB board support

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md) ·
[Guide for adding a Core](../../EXTENDING_SPAGHETTI_LAB.md#4-core--board-variant)

A board definition describes one physical Core variant to Zephyr. It contains
facts fixed by the schematic: MCU, memory, controllers, pins, Ports, Flows,
rails, console, flash layout, and real hardware capabilities.

## What this component owns

- Board identity and supported SoC.
- Static pin routing and peripheral controllers.
- Physical Port, Flow, Bay, and power-rail nodes.
- Board-required defaults and flash/debug runners when needed.

## What this component does not own

- The removable Module assigned to a Port.
- User rules, measurements, network endpoints, or runtime configuration.
- Generic Module Manager, Data, or Runtime behavior.
- Protocol opcodes or host editor schemas (topology is published as data).

## Files

| File | Role |
|---|---|
| `board.yml` | Board name, vendor, SoC, and variants discovered by Zephyr. |
| `<board>.dts` | Concrete hardware, Ports, Flows, rails, Maintenance Link. |
| `Kconfig.<board>` | Board/SoC selection contract. |
| `Kconfig.defconfig` | Hardware-justified default values. |
| `<board>_defconfig` | Minimal `CONFIG_...` options required to boot. |
| `board.cmake` | Flash/debug runners, only when needed. |

## Implemented variants

- `spaghettilab_core_v1/esp32c3` — physical ESP32-C3 Core: USB console, I2C0 on
  verified GPIO3/GPIO4, Port 0, Flow 0.
- `spaghettilab_backbone_v1/esp32s3/procpu` — physical ESP32-S3-MINI-1 Backbone:
  USB Serial/JTAG console, fixed-red STATUS LED D5 on GPIO10 (no RGB),
  I2C0/maintenance on J8 GPIO38/37, CAN TWAI GPIO48/34 (SLUP field update),
  NFC ST25R100 SPI2 on
  GPIO4/3/6 with CS GPIO2, RST GPIO1, IRQ GPIO5.
- `spaghettilab_core_v2_build_only/esp32c3` — simulated portability target with
  two Ports / two Flows. No default flash runner; never flash this target.

Both variants generate the same `spaghettilab,port` / `spaghettilab,flow`
contracts, so common firmware contains no board-name branches.

## Multi-Flow / Bay / rail layout

Add topology in DTS only — no Protocol or editor changes:

```dts
spaghetti_flows {
    compatible = "simple-bus";
    #address-cells = <1>;
    #size-cells = <0>;

    flow0: flow@0 {
        compatible = "spaghettilab,flow";
        reg = <0>;
        port = <&port0>;
        direction = "field-to-core";
        signal-count = <5>;
        function-bay-count = <0>;
        status = "okay";
    };
};

spaghetti_power_rails {
    /* assurance = unmanaged | switched | switched-and-measured */
    /* zero voltage/current properties mean unknown — never invent limits */
};

spaghetti_bay_power {
    /* available-rails lists rail IDs, e.g. <0 1> */
};
```

Logical connector indices are 0–4. Board pinctrl maps them to MCU pins. See
[EXTENDING path 8](../../EXTENDING_SPAGHETTI_LAB.md#8-core-layout-multi-flow--bay--rails)
and bindings under `dts/bindings/spaghetti/`.

## Templates

Copy from `templates/firmware/`:

- `board.yml.template`
- `board.dts.template` (Ports, two Flows, rails, Bay power example)
- `board_defconfig.template`

Directory layout:

```text
boards/spaghettilab/spaghettilab_core_<variant>/
├── board.yml
├── Kconfig.spaghettilab_core_<variant>
├── Kconfig.defconfig
├── spaghettilab_core_<variant>_defconfig
├── spaghettilab_core_<variant>_<qualifier>.dts
└── board.cmake
```

After phase 291 each production board also selects one compile-time resource
profile. That profile controls software capacities; it does not replace
SRAM/flash/radio facts in Devicetree and must not advertise unverified SoC
features.

## Zephyr integration

- Board selection uses the existing `BOARD` value in the Docker build.
- Inspect `build/app/zephyr/zephyr.dts` and `build/app/zephyr/.config` after a
  board change; never edit or commit them.
- Application features belong in `prj.conf`, not in the board defconfig.

## Contract guarantees

- Every production pin and controller reference comes from a real schematic.
- A removable Module never appears as a permanent board child node.
- Higher layers select behavior through Port capabilities and topology
  descriptors, not board-name conditionals.
