#!/usr/bin/env python3
"""Exercise accepted and rejected downstream firmware extension manifests."""

from __future__ import annotations

from pathlib import Path
import shutil
import subprocess


CORE = Path(__file__).resolve().parents[1]
RUNNER = CORE / "tests/firmware_extension_contract/run.cmake"
CASES = CORE / "tests/firmware_extension_contract/cases"


def run_case(name: str, expected: bool) -> None:
    extension = CASES / name
    result = subprocess.run(
        ["cmake", f"-DEXTENSION_DIR={extension}", "-P", str(RUNNER)],
        capture_output=True,
        text=True,
        check=False,
    )
    if (result.returncode == 0) != expected:
        raise AssertionError(f"{name}: expected success={expected}\n{result.stdout}\n{result.stderr}")


def main() -> int:
    if shutil.which("cmake") is None:
        raise SystemExit("cmake is required")
    run_case("compatible", True)
    run_case("missing-manifest", False)
    run_case("wrong-contract", False)
    run_case("future-api", False)
    print("Firmware extension admission verified: 1 accepted, 3 rejected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
