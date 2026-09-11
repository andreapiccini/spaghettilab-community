#!/usr/bin/env python3
"""Flash CORE (ESP32-S3) over USB. Print the physical steps for BACKBONE."""

from __future__ import annotations

import glob
import os
import subprocess
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
from pio_env import find_pio  # noqa: E402

PROJECT = os.path.dirname(SCRIPT_DIR)


def serial_ports() -> list[str]:
    ports = []
    for pattern in (
        "/dev/cu.usbmodem*",
        "/dev/cu.usbserial*",
        "/dev/cu.wchusbserial*",
        "/dev/cu.SLAB_USBtoUART*",
        "/dev/tty.usbmodem*",
        "/dev/ttyACM*",
        "/dev/ttyUSB*",
    ):
        ports.extend(glob.glob(pattern))
    return sorted(set(ports))


def main() -> int:
    os.chdir(PROJECT)
    pio = find_pio()
    print("Uso PlatformIO: %s" % " ".join(pio))
    print("Building BACKBONE + CORE...")
    sys.stdout.flush()
    subprocess.check_call(pio + ["run", "-e", "backbone"])
    factory = os.path.join(PROJECT, ".pio", "build", "backbone", "firmware.factory.bin")
    merged = os.path.join(PROJECT, ".pio", "build", "backbone", "merged.bin")
    if os.path.isfile(factory):
        import shutil
        shutil.copyfile(factory, merged)
    subprocess.check_call(pio + ["run", "-e", "core"])

    ports = serial_ports()
    if not ports:
        print("No USB port is currently available. Waiting up to 25 s for CORE enumeration...")
        sys.stdout.flush()
        deadline = time.time() + 25
        while time.time() < deadline and not ports:
            time.sleep(1)
            ports = serial_ports()
            if ports:
                break
        if not ports:
            print()
            print("No ESP USB port found.")
            print("Connect CORE (ESP32-S3) over USB-C, then run again:")
            print("  python3 scripts/flash_core.py")
            print("If it does not enumerate: hold CORE BOOT, press and release RESET, then reconnect USB.")
            print()
            print("If CORE is already running, its RGB LED should cycle colors at about 1 Hz after flashing.")
            print("To program the C3: hold BOOTLOADER, press and release RESET,")
            print("poi: python3 scripts/core_util.py flash-c3 --rom --bin .pio/build/backbone/merged.bin")
            return 2

    port = ports[0]
    if len(ports) > 1:
        print("Porte trovate: %s — uso %s" % (", ".join(ports), port))
    print("Flashing CORE on %s" % port)
    sys.stdout.flush()
    subprocess.check_call(pio + ["run", "-e", "core", "-t", "upload", "--upload-port", port])
    print()
    print("CORE flash completed. The CORE RGB LED should cycle colors.")
    print()
    print("First BACKBONE flash (blank C3) — J15 USB-UART is the reliable path:")
    print("  J15 pin1 CAN_TX=GPIO21 -> adapter RX; pin2 CAN_RX=GPIO20 <- adapter TX; GND da J1.")
    print("  Hold IO9 low, pulse RESET, then use esptool --chip esp32c3 (the C3 is not on USB).")
    print("  --rom through the S3 can still attempt it (SLIP sync; fails quickly on TX echo only):")
    print("  python3 scripts/core_util.py --port %s flash-c3 --rom --bin .pio/build/backbone/merged.bin" % port)
    print("  All four BACKBONE RGB LEDs should cycle after a successful flash.")
    print("Subsequent updates (C3 application already running):")
    print("  python3 scripts/core_util.py flash-c3 --slup --bin .pio/build/backbone/firmware.bin")
    print("  (UART over the CAN PHY, TWAI off. The C3 is not on USB.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
