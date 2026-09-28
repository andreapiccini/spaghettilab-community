#!/usr/bin/env python3
"""Verify the aggregate firmware extension contract against public headers."""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = Path(__file__).with_name("manifest.json")

DEFINITIONS = {
    "module_driver": ("firmware/backbone/include/spaghetti/module_driver.h", "SPAGHETTI_MODULE_DRIVER_API_VERSION"),
    "rule_driver": ("firmware/backbone/include/spaghetti/rule_driver.h", "SPAGHETTI_RULE_DRIVER_API_VERSION"),
    "block_driver": ("firmware/backbone/include/spaghetti/block_driver.h", "SPAGHETTI_BLOCK_DRIVER_API_VERSION"),
    "discovery_provider": ("firmware/backbone/include/spaghetti/discovery.h", "SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION"),
    "feature_pack": ("firmware/backbone/include/spaghetti/feature_pack.h", "SPAGHETTI_FEATURE_PACK_ABI_VERSION"),
    "protocol": ("firmware/backbone/include/spaghetti/protocol.h", "SPAGHETTI_PROTOCOL_VERSION"),
    "enrollment_backend": ("firmware/backbone/include/spaghetti/enrollment.h", "SPAGHETTI_ENROLLMENT_BACKEND_API_VERSION"),
}


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    errors: list[str] = []
    for component, (relative_path, macro) in DEFINITIONS.items():
        text = (ROOT / relative_path).read_text(encoding="utf-8")
        match = re.search(rf"#define\s+{macro}\s+(\d+)U", text)
        actual = int(match.group(1)) if match else None
        expected = manifest["component_apis"][component]
        if actual != expected:
            errors.append(f"{component}: manifest={expected}, {macro}={actual}")

    if errors:
        print("Firmware extension contract verification failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        "Firmware extension contract verified: "
        f"api={manifest['api_version']} components={len(DEFINITIONS)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
