"""Locate a working PlatformIO CLI without assuming sys.executable has it."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from typing import Optional


def _ok(cmd: list[str]) -> bool:
    try:
        subprocess.check_call(
            cmd + ["--version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except Exception:
        return False


def _python_has_platformio(python: str) -> bool:
    try:
        subprocess.check_call(
            [python, "-c", "import platformio"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except Exception:
        return False


def _known_pio_bins() -> list[str]:
    home = os.path.expanduser("~")
    return [
        os.path.join(home, ".platformio", "penv", "bin", "pio"),
        os.path.join(home, ".platformio", "penv", "bin", "platformio"),
        os.path.join(home, ".local", "bin", "pio"),
        os.path.join(home, ".local", "bin", "platformio"),
        "/opt/homebrew/bin/pio",
        "/usr/local/bin/pio",
    ]


def find_pio() -> list[str]:
    """Return argv prefix to run PlatformIO, e.g. ['/path/to/pio']."""
    for name in ("pio", "platformio"):
        path = shutil.which(name)
        if path and _ok([path]):
            return [path]

    for path in _known_pio_bins():
        if os.path.isfile(path) and os.access(path, os.X_OK) and _ok([path]):
            return [path]

    for python in (sys.executable, shutil.which("python3"), shutil.which("python")):
        if python and _python_has_platformio(python):
            return [python, "-m", "platformio"]

    installed = _install_platformio()
    if installed:
        return installed

    raise SystemExit(
        "PlatformIO was not found. Install it with:\n"
        "  pipx install platformio\n"
        "or:      python3 -m pip install --user platformio"
    )


def _install_platformio() -> Optional[list[str]]:
    print("PlatformIO was not found; attempting installation...")
    pipx = shutil.which("pipx")
    if pipx:
        try:
            subprocess.check_call([pipx, "install", "platformio"])
            path = shutil.which("pio") or os.path.expanduser("~/.local/bin/pio")
            if path and _ok([path]):
                return [path]
        except Exception as exc:
            print("pipx installation failed: %s" % exc)

    penv_pio = os.path.expanduser("~/.platformio/penv/bin/pio")
    if os.path.isfile(penv_pio) and _ok([penv_pio]):
        return [penv_pio]

    python = shutil.which("python3") or sys.executable
    try:
        subprocess.check_call([python, "-m", "pip", "install", "--user", "platformio"])
        if _python_has_platformio(python):
            return [python, "-m", "platformio"]
        user_pio = os.path.expanduser("~/.local/bin/pio")
        if os.path.isfile(user_pio) and _ok([user_pio]):
            return [user_pio]
    except Exception as exc:
        print("pip --user installation failed: %s" % exc)
    return None
