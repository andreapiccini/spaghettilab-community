"""Load BLE application keys from owner-only files (never argv)."""

from __future__ import annotations

import os
import stat
from pathlib import Path

from tools.spaghetti_gateway.constants import ENV_KEY_FILE, KEY_SIZE


class SecretError(RuntimeError):
    """Raised when a key file is missing, world-readable, or wrong size."""


def load_key_from_file(path: str | Path) -> bytes:
    """Read a 32-byte key from a mode-0600 file outside typical repo trees."""
    key_path = Path(path).expanduser()
    if not key_path.is_file():
        raise SecretError(f"key file not found: {key_path}")

    mode = key_path.stat().st_mode
    if os.name != "nt":
        if mode & (stat.S_IRWXG | stat.S_IRWXO):
            raise SecretError(
                f"key file must be mode 0600 (got {stat.filemode(mode)})"
            )

    raw = key_path.read_bytes()
    if len(raw) == KEY_SIZE * 2:
        try:
            key = bytes.fromhex(raw.decode("ascii").strip())
        except (UnicodeDecodeError, ValueError) as exc:
            raise SecretError("key file hex decode failed") from exc
    else:
        key = raw
    if len(key) != KEY_SIZE:
        raise SecretError(f"key must be {KEY_SIZE} bytes")
    return key


def load_key_from_env(env_name: str = ENV_KEY_FILE) -> bytes:
    path = os.environ.get(env_name)
    if not path:
        raise SecretError(f"{env_name} is not set")
    return load_key_from_file(path)


def argv_contains_secret(argv: list[str], key: bytes) -> bool:
    """Return True if the raw key (or hex) appears in argv — must never happen."""
    hex_key = key.hex()
    for item in argv:
        if item == hex_key or item.encode("utf-8", errors="ignore") == key:
            return True
        if len(item) >= KEY_SIZE * 2 and hex_key in item.lower():
            return True
    return False
