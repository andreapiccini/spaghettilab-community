#!/usr/bin/env python3
"""Verify Protocol V1 identifiers across the public language implementations."""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = Path(__file__).with_name("manifest.json")
C_HEADER = ROOT / "firmware/backbone/include/spaghetti/protocol.h"
TS_ENVELOPE = ROOT / "software/micro-flow-editor/packages/protocol-sdk/src/envelope.ts"
PYTHON_SDK = ROOT / "firmware/backbone/tools/spaghetti_protocol.py"
CAPABILITIES_HEADER = ROOT / "firmware/backbone/include/spaghetti/capabilities.h"
TS_CAPABILITIES = ROOT / "software/micro-flow-editor/packages/protocol-sdk/src/operations/capabilities.ts"


def enum_block(text: str, declaration: str) -> str:
    match = re.search(rf"{re.escape(declaration)}\s*\{{(?P<body>.*?)\}}", text, re.S)
    if match is None:
        raise ValueError(f"cannot find {declaration}")
    return match.group("body")


def numeric_members(body: str, prefix: str = "") -> dict[str, int]:
    members: dict[str, int] = {}
    for name, value in re.findall(r"^[ \t]*([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*(\d+)[ \t]*,?", body, re.M):
        if prefix and not name.startswith(prefix):
            continue
        members[name.removeprefix(prefix)] = int(value)
    return members


def python_operation_members(text: str) -> dict[str, int]:
    block = re.search(r"class Operation\(IntEnum\):(?P<body>(?:\n    [^\n]*)+)", text)
    if block is None:
        raise ValueError("cannot find Python Operation enum")
    return numeric_members(block.group("body"))


def capability_bits(text: str) -> dict[str, int]:
    body = enum_block(text, "enum spaghetti_build_capability")
    return {
        name.removeprefix("SPAGHETTI_BUILD_CAP_"): int(bit)
        for name, bit in re.findall(r"^\s*(SPAGHETTI_BUILD_CAP_[A-Z0-9_]+)\s*=\s*BIT\((\d+)\)", body, re.M)
    }


def python_status_members(text: str) -> dict[str, int]:
    block = re.search(r"PROTOCOL_STATUS_CODES\s*=\s*\{(?P<body>.*?)\}", text, re.S)
    if block is None:
        raise ValueError("cannot find PROTOCOL_STATUS_CODES")
    return {
        name.upper(): int(value)
        for name, value in re.findall(r'"([a-z_]+)"\s*:\s*(\d+)', block.group("body"))
    }


def require_equal(label: str, actual: object, expected: object, errors: list[str]) -> None:
    if actual != expected:
        errors.append(f"{label} differs\n  expected={expected}\n  actual={actual}")


def main() -> int:
    manifest = json.loads(CONTRACT.read_text(encoding="utf-8"))
    c_text = C_HEADER.read_text(encoding="utf-8")
    ts_text = TS_ENVELOPE.read_text(encoding="utf-8")
    py_text = PYTHON_SDK.read_text(encoding="utf-8")
    capabilities_text = CAPABILITIES_HEADER.read_text(encoding="utf-8")
    ts_capabilities_text = TS_CAPABILITIES.read_text(encoding="utf-8")
    errors: list[str] = []

    operations = manifest["operations"]
    statuses = manifest["statuses"]
    events = manifest["events"]

    require_equal(
        "C operations",
        numeric_members(enum_block(c_text, "enum spaghetti_protocol_operation"), "SPAGHETTI_PROTOCOL_"),
        operations,
        errors,
    )
    require_equal(
        "C statuses",
        numeric_members(enum_block(c_text, "enum spaghetti_protocol_status"), "SPAGHETTI_PROTOCOL_STATUS_"),
        statuses,
        errors,
    )
    require_equal(
        "C events",
        numeric_members(enum_block(c_text, "enum spaghetti_protocol_event_type"), "SPAGHETTI_PROTOCOL_EVENT_"),
        events,
        errors,
    )
    require_equal("TypeScript operations", numeric_members(enum_block(ts_text, "export enum Operation")), operations, errors)
    require_equal("TypeScript statuses", numeric_members(enum_block(ts_text, "export enum ProtocolStatus")), statuses, errors)
    require_equal("TypeScript events", numeric_members(enum_block(ts_text, "export enum EventType")), events, errors)
    require_equal("Python operations", python_operation_members(py_text), operations, errors)
    require_equal("Python statuses", python_status_members(py_text), statuses, errors)
    require_equal("C build capability bits", capability_bits(capabilities_text), manifest["capabilities"]["build_capability_bits"], errors)

    version_match = re.search(r"#define SPAGHETTI_PROTOCOL_VERSION\s+(\d+)U", c_text)
    ts_version_match = re.search(r"export const PROTOCOL_VERSION\s*=\s*(\d+)", ts_text)
    require_equal("C version", int(version_match.group(1)) if version_match else None, manifest["version"], errors)
    require_equal("TypeScript version", int(ts_version_match.group(1)) if ts_version_match else None, manifest["version"], errors)

    operation_max = max(operations.values())
    operation_max_name = next(name for name, value in operations.items() if value == operation_max)
    ts_max_match = re.search(r"const OPERATION_MAX\s*=\s*Operation\.([A-Z0-9_]+)", ts_text)
    require_equal("TypeScript operation validation maximum", ts_max_match.group(1) if ts_max_match else None, operation_max_name, errors)

    actual_fields = {
        name: int(key)
        for key, name in re.findall(r"(?:u32|text)Field\((\d+), r\.([a-zA-Z0-9]+)\)", ts_capabilities_text)
    }
    require_equal("TypeScript capability response fields", actual_fields, manifest["capabilities"]["get_capabilities_response_fields"], errors)

    vectors = CONTRACT.parent / manifest["vectors"]
    expected_vectors = {"catalog", "config", "error", "int64min", "record", "request", "response", "uint64max"}
    actual_vectors = {path.stem for path in vectors.glob("*.json")}
    require_equal("golden vector set", actual_vectors, expected_vectors, errors)

    if errors:
        print("Protocol V1 contract verification failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        "Protocol V1 contract verified: "
        f"version={manifest['version']} operations={len(operations)} "
        f"statuses={len(statuses)} events={len(events)} vectors={len(actual_vectors)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
