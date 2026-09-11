# Extra script for env:core — build BACKBONE first and embed the merged image.
Import("env")

import os
import shutil
import subprocess
import sys

PROJECT_DIR = env["PROJECT_DIR"]
PIOENV = env["PIOENV"]
sys.path.insert(0, os.path.join(PROJECT_DIR, "scripts"))
from pio_env import find_pio  # noqa: E402


def find_boot_app0():
    home = os.environ.get("HOME", "")
    pkg = os.path.join(home, ".platformio/packages/framework-arduinoespressif32")
    for root, dirs, files in os.walk(pkg):
        if "boot_app0.bin" in files:
            return os.path.join(root, "boot_app0.bin")
        dirs[:] = [d for d in dirs if d not in (".git",)]
    return None


def xxd_header(bin_path, header_path):
    data = open(bin_path, "rb").read()
    os.makedirs(os.path.dirname(header_path), exist_ok=True)
    with open(header_path, "w") as f:
        f.write("#pragma once\n\n#include <stddef.h>\n#include <stdint.h>\n\n")
        f.write("// Generated from BACKBONE merged image. Do not edit.\n")
        f.write("static const uint8_t backbone_firmware[] = {\n")
        for i, b in enumerate(data):
            if i % 16 == 0:
                f.write("    ")
            f.write("0x%02x," % b)
            if i % 16 == 15 or i == len(data) - 1:
                f.write("\n")
            else:
                f.write(" ")
        f.write("};\n\n")
        f.write("static const size_t backbone_firmware_len = sizeof(backbone_firmware);\n")
    print("embedded %s (%d bytes) -> %s" % (bin_path, len(data), header_path))


def esptool_cmd():
    for name in ("esptool", "esptool.py"):
        path = shutil.which(name)
        if path:
            return [path]
    raise SystemExit("esptool not found in PATH")


if PIOENV == "core":
    pio = find_pio()
    if os.environ.get("BRINGUP_SKIP_NESTED") != "1":
        nested_env = os.environ.copy()
        nested_env["BRINGUP_SKIP_NESTED"] = "1"
        print("Building BACKBONE image to embed in CORE...")
        subprocess.check_call(pio + ["run", "-e", "backbone", "-d", PROJECT_DIR], env=nested_env)

    build_dir = os.path.join(PROJECT_DIR, ".pio", "build", "backbone")
    firmware = os.path.join(build_dir, "firmware.bin")
    bootloader = os.path.join(build_dir, "bootloader.bin")
    partitions = os.path.join(build_dir, "partitions.bin")
    merged = os.path.join(build_dir, "merged.bin")
    header = os.path.join(PROJECT_DIR, "src", "core", "backbone_fw.h")

    if not os.path.isfile(firmware):
        sys.exit("BACKBONE firmware.bin missing at %s" % firmware)

    boot_app0 = find_boot_app0()
    if not boot_app0:
        sys.exit("boot_app0.bin not found in PlatformIO packages")

    cmd = esptool_cmd() + [
        "--chip",
        "esp32c3",
        "merge-bin",
        "-o",
        merged,
        "--flash-mode",
        "dio",
        "--flash-freq",
        "80m",
        "--flash-size",
        "4MB",
        "0x0",
        bootloader,
        "0x8000",
        partitions,
        "0xe000",
        boot_app0,
        "0x10000",
        firmware,
    ]
    print(" ".join(cmd))
    subprocess.check_call(cmd)
    xxd_header(merged, header)
