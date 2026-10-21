# Backbone V2

Target: `spaghettilab_backbone_v2/esp32s3/procpu`, ESP32-S3-MINI-1 N8.

| Signal | GPIO | Firmware mapping |
| --- | --- | --- |
| A0–A3 | 7, 8, 9, 10 | User port 0, channels 0–3; GPIO, I2C, UART, SPI, PWM |
| A4–A7 | 12, 13, 14, 15 | GPIO port 2, channels 0–3 |
| Internal LED | 11 | Active low, LEDC channel 4, timer 2 |
| CAN TX / RX | 48 / 34 | CAN port 1 |
| USB D− / D+ | 19 / 20 | Native USB Serial/JTAG |
| NFC reset / CS / MOSI / SCK / IRQ / MISO | 1 / 2 / 3 / 4 / 5 / 6 | Same ST25R100 interface as V1 |

A4–A7 are exposed as a separate GPIO port to preserve the existing four-channel
user-port configuration format. The current physical module editor configures
A0–A3; it does not yet offer A4–A7 or PWM/ADC on that second bank.
`layout-version = 2` identifies the V2 hardware connector. Descriptor byte 0
independently reports wire format version 2; configurable modes remain the first four channels.

Build from `firmware/backbone`:

```sh
docker compose run --rm --entrypoint sh dev -lc 'west build --sysbuild -b spaghettilab_backbone_v2/esp32s3/procpu -d build-backbone-v2 -- -DBOARD_ROOT=/opt/zephyrproject/app -DDTS_ROOT=/opt/zephyrproject/app'
```

For initial provisioning flash the generated MCUboot image at `0x0` and signed
application at `0x20000`. Use the V2 image only on V2 hardware. V1 retains its
separate target and original GPIO38–35 / LED GPIO10 mapping.
