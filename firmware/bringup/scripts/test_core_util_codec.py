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

    print("core_util codec tests passed")


if __name__ == "__main__":
    main()
