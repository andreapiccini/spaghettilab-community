#!/usr/bin/env python3
"""Produce Spaghetti LAB feature-pack and resource reports.

Reads declared Kconfig budgets from a build `.config` when available, otherwise
from source Kconfig defaults. Optionally reads flash/RAM from `zephyr.stat` or
`zephyr.map`. Gates FAIL when measured sizes exceed declared budgets; when
measurements are unavailable, FAIL only if pack/manifest metadata is missing.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = ROOT / "build" / "resource-report"

BUDGET_KEYS = (
    "CONFIG_SPAGHETTI_FLASH_SLOT_BYTES",
    "CONFIG_SPAGHETTI_FLASH_IMAGE_BUDGET_BYTES",
    "CONFIG_SPAGHETTI_FLASH_HEADROOM_BYTES",
    "CONFIG_SPAGHETTI_STATIC_RAM_BUDGET_BYTES",
    "CONFIG_SPAGHETTI_DECLARED_STACK_BYTES",
    "CONFIG_SPAGHETTI_DECLARED_POOL_BYTES",
    "CONFIG_SPAGHETTI_DECLARED_WORKSPACE_BYTES",
)

PACK_FILES = {
    "core-basic": "subsys/feature_registry/pack_core_basic.c",
    "processing-basic": "subsys/feature_registry/pack_processing_basic.c",
    "processing-kalman": "subsys/feature_registry/pack_processing_kalman.c",
    "device-profile-engine": "subsys/feature_registry/pack_device_profile.c",
    "transport-modbus": "subsys/feature_registry/pack_transport_modbus.c",
}


def parse_config(path: Path | None) -> dict[str, str]:
    values: dict[str, str] = {}
    if path is None or not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"')
    return values


def discover_packs(config: dict[str, str]) -> list[dict[str, str]]:
    packs = [{"id": "core-basic", "version": "1.0.0", "enabled": True}]
    mapping = (
        ("processing-basic", "CONFIG_SPAGHETTI_PACK_PROCESSING_BASIC", "1.0.0"),
        ("processing-kalman", "CONFIG_SPAGHETTI_PACK_PROCESSING_KALMAN", "1.0.0"),
        ("device-profile-engine", "CONFIG_SPAGHETTI_PACK_DEVICE_PROFILE", "1.0.0"),
        ("transport-modbus", "CONFIG_SPAGHETTI_PACK_MODBUS", "0.1.0"),
    )
    for pack_id, symbol, version in mapping:
        enabled = config.get(symbol) == "y"
        if symbol not in config and pack_id in (
            "processing-basic",
            "device-profile-engine",
        ):
            enabled = True
        packs.append({"id": pack_id, "version": version, "enabled": enabled})
    return packs


def read_zephyr_stat(path: Path | None) -> dict[str, int]:
    result: dict[str, int] = {}
    if path is None or not path.is_file():
        return result
    text = path.read_text(encoding="utf-8", errors="replace")
    for key, pattern in (
        ("flash_used", r"Flash:\s*(\d+)\s*bytes"),
        ("ram_used", r"RAM:\s*(\d+)\s*bytes"),
        ("flash_used", r"FLASH:\s*(\d+)"),
        ("ram_used", r"SRAM:\s*(\d+)"),
    ):
        match = re.search(pattern, text, re.IGNORECASE)
        if match and key not in result:
            result[key] = int(match.group(1))
    return result


def read_map_sizes(path: Path | None) -> dict[str, int]:
    result: dict[str, int] = {}
    if path is None or not path.is_file():
        return result
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"_image_ram_size\s*=\s*(0x[0-9a-fA-F]+|\d+)", text)
    if match:
        result["ram_used"] = int(match.group(1), 0)
    match = re.search(r"_flash_used\s*=\s*(0x[0-9a-fA-F]+|\d+)", text)
    if match:
        result["flash_used"] = int(match.group(1), 0)
    return result


def int_config(config: dict[str, str], key: str, default: int) -> int:
    raw = config.get(key)
    if raw is None:
        return default
    try:
        return int(raw, 0)
    except ValueError:
        return default


def build_report(
    config: dict[str, str],
    measured: dict[str, int],
    profile_name: str,
) -> dict:
    packs = discover_packs(config)
    enabled_packs = [p for p in packs if p["enabled"]]
    budgets = {
        "flash_slot_bytes": int_config(
            config, "CONFIG_SPAGHETTI_FLASH_SLOT_BYTES", 1048576
        ),
        "flash_image_budget_bytes": int_config(
            config, "CONFIG_SPAGHETTI_FLASH_IMAGE_BUDGET_BYTES", 917504
        ),
        "flash_headroom_bytes": int_config(
            config, "CONFIG_SPAGHETTI_FLASH_HEADROOM_BYTES", 65536
        ),
        "static_ram_budget_bytes": int_config(
            config, "CONFIG_SPAGHETTI_STATIC_RAM_BUDGET_BYTES", 327680
        ),
        "declared_stack_bytes": int_config(
            config, "CONFIG_SPAGHETTI_DECLARED_STACK_BYTES", 24576
        ),
        "declared_pool_bytes": int_config(
            config, "CONFIG_SPAGHETTI_DECLARED_POOL_BYTES", 65536
        ),
        "declared_workspace_bytes": int_config(
            config, "CONFIG_SPAGHETTI_DECLARED_WORKSPACE_BYTES", 60000
        ),
    }

    reasons: list[str] = []
    status = "PASS"

    for pack in PACK_FILES:
        path = ROOT / PACK_FILES[pack]
        if not path.is_file():
            status = "FAIL"
            reasons.append(f"missing pack source {PACK_FILES[pack]}")

    manifest_header = ROOT / "include" / "spaghetti" / "image_manifest.h"
    if not manifest_header.is_file():
        status = "FAIL"
        reasons.append("missing image_manifest.h")

    if measured.get("flash_used") is not None:
        if measured["flash_used"] > budgets["flash_image_budget_bytes"]:
            status = "FAIL"
            reasons.append(
                "flash image exceeds budget "
                f"({measured['flash_used']} > {budgets['flash_image_budget_bytes']})"
            )
    if measured.get("ram_used") is not None:
        if measured["ram_used"] > budgets["static_ram_budget_bytes"]:
            status = "FAIL"
            reasons.append(
                "static RAM exceeds budget "
                f"({measured['ram_used']} > {budgets['static_ram_budget_bytes']})"
            )

    if not reasons:
        reasons.append("declared budgets and pack catalog present")

    return {
        "profile": profile_name,
        "core_variant": config.get("CONFIG_SPAGHETTI_CORE_VARIANT", "unknown"),
        "packs": enabled_packs,
        "all_packs": packs,
        "budgets": budgets,
        "measured": measured,
        "gate": {"status": status, "reasons": reasons},
        "notes": [
            "free_ram is not an installability promise",
            "profiles: minimal / standard / all-supported (kalman+modbus overlays)",
        ],
    }


def render_text(report: dict) -> str:
    lines = [
        f"Spaghetti resource report ({report['profile']})",
        f"Core variant: {report['core_variant']}",
        f"Gate: {report['gate']['status']}",
        "Reasons:",
    ]
    for reason in report["gate"]["reasons"]:
        lines.append(f"  - {reason}")
    lines.append("Enabled packs:")
    for pack in report["packs"]:
        lines.append(f"  - {pack['id']}@{pack['version']}")
    lines.append("Declared budgets:")
    for key, value in report["budgets"].items():
        lines.append(f"  - {key}: {value}")
    if report["measured"]:
        lines.append("Measured:")
        for key, value in report["measured"].items():
            lines.append(f"  - {key}: {value}")
    else:
        lines.append("Measured: unavailable (using declared budgets only)")
    lines.append("Notes:")
    for note in report["notes"]:
        lines.append(f"  - {note}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--build-dir",
        type=Path,
        default=ROOT / "build",
        help="West/sysbuild directory containing app/.config when present",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help="Directory for JSON and text reports",
    )
    parser.add_argument(
        "--profile",
        default="standard",
        choices=("minimal", "standard", "all-supported"),
        help="Logical profile label for the report",
    )
    args = parser.parse_args()

    candidates = [
        args.build_dir / "app" / "zephyr" / ".config",
        args.build_dir / "zephyr" / ".config",
        args.build_dir / ".config",
    ]
    config_path = next((path for path in candidates if path.is_file()), None)
    config = parse_config(config_path)

    measured: dict[str, int] = {}
    for stat_candidate in (
        args.build_dir / "app" / "zephyr" / "zephyr.stat",
        args.build_dir / "zephyr" / "zephyr.stat",
    ):
        measured.update(read_zephyr_stat(stat_candidate))
    for map_candidate in (
        args.build_dir / "app" / "zephyr" / "zephyr.map",
        args.build_dir / "zephyr" / "zephyr.map",
    ):
        for key, value in read_map_sizes(map_candidate).items():
            measured.setdefault(key, value)

    if args.profile == "all-supported":
        config.setdefault("CONFIG_SPAGHETTI_BLOCK_KALMAN", "y")
        config.setdefault("CONFIG_SPAGHETTI_PACK_PROCESSING_KALMAN", "y")
        config.setdefault("CONFIG_SPAGHETTI_PACK_MODBUS", "y")

    report = build_report(config, measured, args.profile)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    json_path = args.out_dir / f"resource-report-{args.profile}.json"
    text_path = args.out_dir / f"resource-report-{args.profile}.txt"
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    text_path.write_text(render_text(report), encoding="utf-8")
    print(render_text(report), end="")
    print(f"Wrote {json_path}")
    print(f"Wrote {text_path}")
    return 0 if report["gate"]["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
