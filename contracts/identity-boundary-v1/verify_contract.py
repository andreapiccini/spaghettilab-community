#!/usr/bin/env python3
"""Verify the public/private identity boundary and enrollment fallback."""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = Path(__file__).with_name("manifest.json")
HEADER = ROOT / "firmware/backbone/include/spaghetti/enrollment.h"
SOURCE = ROOT / "firmware/backbone/subsys/services/identity/enrollment.c"


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    header = HEADER.read_text(encoding="utf-8")
    source = SOURCE.read_text(encoding="utf-8")
    match = re.search(r"SPAGHETTI_ENROLLMENT_BACKEND_API_VERSION\s+(\d+)U", header)
    actual = int(match.group(1)) if match else None
    expected = manifest["optional_backend"]["api_version"]
    errors: list[str] = []
    if actual != expected:
        errors.append(f"enrollment header API={actual}, manifest API={expected}")
    for required in ("__weak", "SPAGHETTI_ENROLLMENT_UNMANAGED", "-ENOTSUP", "-EPROTONOSUPPORT"):
        if required not in source:
            errors.append(f"Community fallback is missing {required}")
    if errors:
        print("Identity boundary verification failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Identity boundary verified: version={manifest['version']} enrollment_api={actual}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
