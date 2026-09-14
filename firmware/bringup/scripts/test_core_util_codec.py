#!/usr/bin/env python3
"""Small dependency-free regression tests for the console wire codec."""

import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("core_util.py")
SPEC = importlib.util.spec_from_file_location("core_util", MODULE_PATH)
assert SPEC and SPEC.loader
core_util = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(core_util)


def main() -> None:
    values = (0, 1, 127, 128, 255, 16384, 0x0D6730, 0xFFFFFFFF)
    for value in values:
        encoded = core_util.encode_varint(value)
        decoded, offset = core_util.decode_varint(encoded, 0)
        assert decoded == value
        assert offset == len(encoded)

    try:
        core_util.decode_varint(b"\x80", 0)
    except ValueError as error:
        assert str(error) == "truncated varint"
    else:
        raise AssertionError("truncated varint was accepted")

    message = core_util.host_msg(1, 13, core_util.encode_uint32(1, 1_025_000), 0x0D6730)
    fields = core_util.decode_fields(message)
    assert fields[1][0][1] == 1
    assert fields[2][0][1] == 0x0D6730
    assert fields[3][0][1] == 1
    assert core_util.decode_fields(fields[13][0][1])[1][0][1] == 1_025_000

    assert core_util.ntag_static_lock_mask(True, True, True) == (0xFF, 0xFF)
    assert core_util.ntag_static_lock_mask(False, True, False) == (0xF0, 0xFF)
    assert core_util.ntag_dynamic_lock_mask("NTAG213 / 144 B", True) == bytes((0xFF, 0x0F, 0x3F, 0x00))
    assert core_util.ndef_prefix_len(bytes.fromhex("01 03 A0 0C 34 03 00 FE")) == 5
    uri = core_util.encode_ndef_uri("https://spaghettilab.com")
    assert uri[0] == 0x03 and uri[-1] == 0xFE
    assert uri[5] == 0x55 and uri[6] == 0x04  # URI record, prefix https://
    text = core_util.encode_ndef_text("ciao")
    assert text[5] == 0x54
    pages = core_util.pages_from_bytes(4, bytes.fromhex("01 03 A0 0C 34") + text)
    assert pages[0] == (4, bytes.fromhex("01 03 A0 0C"))
    assert pages[1][0] == 5

    print("core_util codec tests passed")


if __name__ == "__main__":
    main()
