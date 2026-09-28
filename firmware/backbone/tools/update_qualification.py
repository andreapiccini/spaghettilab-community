#!/usr/bin/env python3
"""Create reproducible evidence and check the hardware update report."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import stat
import struct
import subprocess
import sys


MCUBOOT_IMAGE_MAGIC = 0x96F3B83D
MCUBOOT_HEADER = struct.Struct("<IIHHIIBBHII")
FINAL_STATUSES = {"PASS", "FAIL", "N/A"}


class QualificationError(RuntimeError):
    """Describe one actionable qualification-tool failure."""


def sha256_file(path: Path) -> str:
    """Return the lowercase SHA-256 of one existing regular file."""
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            while chunk := stream.read(64 * 1024):
                digest.update(chunk)
    except OSError as exc:
        raise QualificationError(f"Cannot read artifact: {path}.") from exc
    return digest.hexdigest()


def mcuboot_image_metadata(path: Path) -> dict[str, int | str]:
    """Read the public 32-byte MCUboot image header without trusting the image."""
    try:
        with path.open("rb") as stream:
            raw_header = stream.read(MCUBOOT_HEADER.size)
    except OSError as exc:
        raise QualificationError(f"Cannot read signed application: {path}.") from exc
    if len(raw_header) != MCUBOOT_HEADER.size:
        raise QualificationError(f"MCUboot header is truncated: {path}.")
    (
        magic,
        load_address,
        header_size,
        protected_tlv_size,
        image_size,
        flags,
        major,
        minor,
        revision,
        build,
        _padding,
    ) = MCUBOOT_HEADER.unpack(raw_header)
    if magic != MCUBOOT_IMAGE_MAGIC:
        raise QualificationError(f"MCUboot image magic is invalid: {path}.")
    return {
        "version": f"{major}.{minor}.{revision}+{build}",
        "load_address": load_address,
        "header_size": header_size,
        "protected_tlv_size": protected_tlv_size,
        "image_size": image_size,
        "flags": flags,
    }


def git_output(project: Path, *arguments: str) -> str:
    """Run one read-only Git query and return trimmed UTF-8 output."""
    result = subprocess.run(
        ["git", "-C", str(project), *arguments],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise QualificationError(result.stderr.strip() or "Git query failed.")
    return result.stdout.strip()


def tracked_secret_candidates(project: Path) -> list[str]:
    """Return tracked paths whose names look like private credential material."""
    tracked = git_output(project, "ls-files").splitlines()
    candidates = []
    for relative in tracked:
        lowered = relative.lower()
        if (
            "/.keys/" in f"/{lowered}"
            or lowered.endswith((".pem", ".p12", ".pfx", ".private-key"))
            or (lowered.endswith(".json") and "credential" in lowered)
        ):
            candidates.append(relative)
    return candidates


def private_file_mode_findings(project: Path) -> list[str]:
    """Find local key files readable or writable by group/other on POSIX."""
    key_directory = project / ".keys"
    if not key_directory.is_dir():
        return []
    findings = []
    for path in sorted(key_directory.rglob("*")):
        if not path.is_file():
            continue
        mode = stat.S_IMODE(path.stat().st_mode)
        if mode & 0o077:
            findings.append(f"{path.relative_to(project)} mode={mode:04o}")
    return findings


def artifact_record(path: Path, project: Path) -> dict[str, int | str]:
    """Build one stable evidence record for an artifact."""
    if not path.is_file():
        raise QualificationError(f"Missing build artifact: {path}.")
    try:
        display_path = str(path.relative_to(project))
    except ValueError:
        display_path = str(path)
    return {
        "path": display_path,
        "size": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def generated_version(path: Path, macro: str) -> str:
    """Read one quoted version macro from a generated Zephyr header."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise QualificationError(f"Cannot read generated version: {path}.") from exc
    prefix = f"#define {macro}"
    for line in lines:
        if line.startswith(prefix):
            fields = line.split('"')
            if len(fields) >= 3 and fields[1]:
                return fields[1]
    raise QualificationError(f"Missing {macro} in generated header: {path}.")


def build_manifest(args: argparse.Namespace) -> dict[str, object]:
    """Collect build, Git, image, and local-secret evidence without secrets."""
    if not args.board_revision.strip():
        raise QualificationError("Board revision must not be empty.")
    if not args.device_serial.strip():
        raise QualificationError("Device serial must not be empty.")
    project = Path(args.project).resolve()
    application = (project / args.application).resolve()
    bootloader = (project / args.bootloader).resolve()
    public_key = (project / args.public_key_source).resolve()
    app_record = artifact_record(application, project)
    app_record.update(mcuboot_image_metadata(application))
    if app_record["version"] == "0.0.0+0":
        raise QualificationError(
            "Application version 0.0.0+0 cannot exercise downgrade prevention."
        )
    boot_record = artifact_record(bootloader, project)
    status = git_output(project, "status", "--porcelain")
    return {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "board_revision": args.board_revision,
        "device_serial": args.device_serial,
        "git_commit": git_output(project, "rev-parse", "HEAD"),
        "git_dirty": bool(status),
        "zephyr_version": generated_version(
            project / "build/app/zephyr/include/generated/zephyr/version.h",
            "KERNEL_VERSION_STRING",
        ),
        "mcuboot_version": generated_version(
            project / "build/mcuboot/zephyr/include/generated/zephyr/app_version.h",
            "APP_VERSION_STRING",
        ),
        "artifacts": {
            "application": app_record,
            "bootloader": boot_record,
            "generated_public_key": artifact_record(public_key, project),
        },
        "security_checks": {
            "tracked_secret_candidates": tracked_secret_candidates(project),
            "unsafe_private_file_modes": private_file_mode_findings(project),
        },
    }


def report_case_statuses(text: str) -> dict[str, str]:
    """Extract Q-xxx case IDs and normalized status fields from Markdown rows."""
    statuses = {}
    for line in text.splitlines():
        if not line.startswith("| Q-"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 5:
            raise QualificationError(f"Malformed qualification row: {line}")
        case_id = cells[0]
        if case_id in statuses:
            raise QualificationError(f"Duplicate qualification case: {case_id}.")
        statuses[case_id] = cells[4].upper()
    return statuses


def run_manifest(args: argparse.Namespace) -> int:
    """Print a machine-readable manifest without writing secret material."""
    print(json.dumps(build_manifest(args), indent=2, sort_keys=True))
    return 0


def run_check_report(args: argparse.Namespace) -> int:
    """Require every versioned hardware case to have a final recorded result."""
    report = Path(args.report)
    try:
        statuses = report_case_statuses(report.read_text(encoding="utf-8"))
    except OSError as exc:
        raise QualificationError(f"Cannot read qualification report: {report}.") from exc
    if not statuses:
        raise QualificationError("The report contains no Q-* qualification cases.")
    pending = {
        case_id: status
        for case_id, status in statuses.items()
        if status not in FINAL_STATUSES
    }
    failures = [case_id for case_id, status in statuses.items() if status == "FAIL"]
    print(f"Qualification cases: {len(statuses)}")
    print(f"Final results: {len(statuses) - len(pending)}")
    if pending:
        print("Pending: " + ", ".join(sorted(pending)))
    if failures:
        print("Failed: " + ", ".join(sorted(failures)))
    return 1 if pending or failures else 0


def build_parser() -> argparse.ArgumentParser:
    """Create the command-line contract used by Make targets and CI."""
    parser = argparse.ArgumentParser(
        description="Collect and check Spaghetti LAB update qualification evidence."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    manifest = subparsers.add_parser("manifest")
    manifest.add_argument("--project", default=".")
    manifest.add_argument(
        "--application", default="build/app/zephyr/zephyr.signed.bin"
    )
    manifest.add_argument(
        "--bootloader", default="build/mcuboot/zephyr/zephyr.bin"
    )
    manifest.add_argument(
        "--public-key-source", default="build/mcuboot/zephyr/autogen-pubkey.c"
    )
    manifest.add_argument("--board-revision", required=True)
    manifest.add_argument("--device-serial", required=True)
    check = subparsers.add_parser("check-report")
    check.add_argument(
        "--report", default="verification/update/QUALIFICATION_REPORT.md"
    )
    return parser


def main() -> int:
    """Dispatch one bounded qualification operation."""
    args = build_parser().parse_args()
    try:
        if args.command == "manifest":
            return run_manifest(args)
        return run_check_report(args)
    except QualificationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
