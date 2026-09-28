#!/usr/bin/env python3
"""CLI entry for the Spaghetti BLE → Node-RED gateway."""

from __future__ import annotations

import sys
from pathlib import Path

# Allow `python tools/spaghetti_ble_gateway.py` from firmware/backbone.
_CORE_ROOT = Path(__file__).resolve().parents[1]
if str(_CORE_ROOT) not in sys.path:
    sys.path.insert(0, str(_CORE_ROOT))

from tools.spaghetti_gateway.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
