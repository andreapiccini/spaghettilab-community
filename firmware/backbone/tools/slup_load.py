#!/usr/bin/env python3
"""Send a PC firmware image through the USB master onto a CAN peer."""

from __future__ import annotations

import argparse
import re
import struct
import sys
import time
import zlib
from pathlib import Path

import serial

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools.device import ToolError, selected_port  # noqa: E402

LIST_ROW = re.compile(
    rb"^(\d+)\s+(master|peer)\s+0x([0-9a-fA-F]+)", re.MULTILINE
)
DEFAULT_IMAGE = ROOT / "build" / "app" / "zephyr" / "zephyr.signed.bin"
CREDIT = 256


def wait_for(ser: serial.Serial, token: bytes, timeout: float) -> bytes:
    """Read until token appears or timeout."""
    deadline = time.monotonic() + timeout
    buf = bytearray()
    while time.monotonic() < deadline:
        chunk = ser.read(ser.in_waiting or 1)
        if chunk:
            buf.extend(chunk)
            if token in buf:
                return bytes(buf)
        else:
            time.sleep(0.01)
    raise ToolError(
        f"timed out waiting for {token!r}: {buf[-200:]!r}"
    )


def resolve_target(ser: serial.Serial, target: str) -> int:
    """Map a list index or 0xNODE to the 24-bit node id."""
    text = target.strip()
    if text.lower().startswith("0x"):
        return int(text, 0) & 0xFFFFFF
    if text.isdigit():
        index = int(text, 10)
        ser.write(b"slup list\n")
        blob = wait_for(ser, b"load/blink", 3.0)
        for match in LIST_ROW.finditer(blob):
            if int(match.group(1)) == index:
                return int(match.group(3), 16)
        raise ToolError(f"idx {index} not in slup list:\n{blob.decode(errors='replace')}")
    raise ToolError("TARGET must be a list idx (2) or 0xNODE")


def send_image(ser: serial.Serial, dest: int, image: bytes) -> None:
    """Arm recv and stream size+crc+payload with 256-byte credits."""
    crc = zlib.crc32(image) & 0xFFFFFFFF
    ser.write(f"slup recv 0x{dest:06x}\n".encode("ascii"))
    wait_for(ser, b"SLUP_RECV", 5.0)
    ser.write(struct.pack("<II", len(image), crc))
    offset = 0
    while offset < len(image):
        n = min(CREDIT, len(image) - offset)
        ser.write(image[offset : offset + n])
        ser.flush()
        wait_for(ser, b".", 30.0)
        offset += n
        print(f"SLUP usb {offset * 100 // len(image)}%", flush=True)
    wait_for(ser, b"SLUP_OK", 30.0)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Load a signed image from the PC onto one Backbone over CAN."
    )
    parser.add_argument("--image", default=str(DEFAULT_IMAGE))
    parser.add_argument("--target", required=True, help="list idx or 0xNODE")
    parser.add_argument("--port")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()

    port = selected_port(args.port)
    ser = serial.Serial(port, args.baud, timeout=0.2)
    try:
        ser.reset_input_buffer()
        ser.write(b"\x03")
        time.sleep(0.3)
        ser.reset_input_buffer()
        if args.list:
            ser.write(b"slup list\n")
            sys.stdout.write(wait_for(ser, b"load/blink", 3.0).decode(errors="replace"))
            return 0
        image_path = Path(args.image)
        if not image_path.is_file():
            raise ToolError(f"missing image: {image_path}")
        dest = resolve_target(ser, args.target)
        send_image(ser, dest, image_path.read_bytes())
        print(f"SLUP_OK dest=0x{dest:06x} bytes={image_path.stat().st_size}")
        return 0
    finally:
        ser.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ToolError as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(2) from exc
